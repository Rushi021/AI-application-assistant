from datetime import datetime
import json
from typing import Any

from fastapi import APIRouter, Depends, UploadFile, File
from pathlib import Path
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import (
    SqlAlchemyJobRepo,
    SqlAlchemyResumeRepo,
    SqlAlchemyResumeSectionRepo,
    SqlAlchemyTailorRunRepo,
)
from app.common.errors import bad_request, not_found
from app.common.ports import ResumeStorage
from app.core.deps import (
    get_current_user,
    get_db,
    get_model_gateway,
    get_resume_storage,
)
from app.modules.ai.gateway import ModelGateway
from app.modules.ai.orchestrator import run_line_tailor_and_cover_letter
from app.modules.ai.prompts.pipeline import (
    build_bullet_rewrite_prompt,
    build_section_rewrite_prompt,
)
from app.modules.applications.service import upsert_application
from app.modules.documents.library import export_stem, export_to_library
from app.modules.documents.renderer import (
    render_docx_from_sections,
    render_from_sections,
)
from app.modules.resumes.docx_parser import parse_docx
from app.modules.resumes.latex_parser import escape_latex_text
from app.modules.tailoring.models import TailorRun
from app.modules.tailoring.schemas import (
    RewriteRequest,
    SectionPatch,
    TailorCreate,
    TailorRunRead,
)

router = APIRouter(prefix="/tailoring", tags=["tailoring"])


def _bullet_dict(bullet_id: int, order_index: int, bullet) -> dict[str, Any]:
    return {
        "id": bullet_id,
        "order_index": order_index,
        "text": bullet.text,
        "original_text": bullet.original_text or bullet.text,
        "latex_source": bullet.latex_source,
        "latex_original": bullet.latex_original,
        "locator": bullet.locator,
        "kind": bullet.kind,
        "editable": bullet.editable,
        "frozen_reason": bullet.frozen_reason,
    }


def _snapshot_from_parse(parsed) -> list[dict[str, Any]]:
    """Snapshot built from a fresh parse, so every line keeps its source locator.

    Ids are positional and only have to be stable inside this run's JSON, which is
    all the edit and rewrite endpoints address.
    """
    sections: list[dict[str, Any]] = []
    next_id = 1
    for index, section in enumerate(parsed.sections):
        bullets = []
        for order_index, bullet in enumerate(section.bullets):
            bullets.append(_bullet_dict(next_id, order_index, bullet))
            next_id += 1
        sections.append(
            {
                "id": next_id,
                "name": section.name,
                "order_index": index,
                "body_text": section.body_text,
                "latex_source": section.latex_source,
                "header_latex": section.header_latex,
                "locator": section.locator,
                "editable": section.editable,
                "frozen_reason": section.frozen_reason,
                "bullets": bullets,
            }
        )
        next_id += 1
    return sections


def _snapshot_from_db(resume_id: int, db: Session) -> list[dict[str, Any]]:
    sections = SqlAlchemyResumeSectionRepo(db).list_sections(resume_id)
    return [
        {
            "id": section.id,
            "name": section.name,
            "order_index": section.order_index,
            "body_text": section.body_text,
            "latex_source": section.latex_source,
            "header_latex": "",
            "locator": None,
            "editable": True,
            "frozen_reason": "",
            "bullets": [
                {
                    "id": b.id,
                    "order_index": b.order_index,
                    "text": b.text,
                    "original_text": b.text,
                    "latex_source": b.latex_source,
                    "latex_original": b.latex_source,
                    "locator": None,
                    "kind": "bullet",
                    "editable": True,
                    "frozen_reason": "",
                }
                for b in section.bullets
            ],
        }
        for section in sections
    ]


def _read_original(resume, storage: ResumeStorage) -> bytes:
    with open(storage.get_file_url_or_path(resume.file_key), "rb") as handle:
        return handle.read()


def _sections_snapshot(
    resume, db: Session, storage: ResumeStorage
) -> list[dict[str, Any]]:
    """Reparse the upload for formats that write edits back into the original file."""
    if resume.source_format == "docx":
        return _snapshot_from_parse(parse_docx(_read_original(resume, storage)))
    from app.modules.resumes.latex_parser import parse_latex

    if resume.source_format == "tex":
        return _snapshot_from_parse(
            parse_latex(
                _read_original(resume, storage).decode("utf-8", errors="replace")
            )
        )
    return _snapshot_from_db(resume.id, db)


def _editable_items(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for section in sections:
        if not section.get("editable", True):
            continue
        for bullet in section.get("bullets") or []:
            if not bullet.get("editable", True):
                continue
            text = (bullet.get("text") or "").strip()
            if text:
                items.append(
                    {
                        "id": bullet["id"],
                        "section": section.get("name") or "Resume",
                        "text": text,
                    }
                )
    return items


def _frozen_context(sections: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for section in sections:
        if section.get("editable", True):
            continue
        lines.append(section.get("name") or "Section")
        for bullet in section.get("bullets") or []:
            if bullet.get("text"):
                lines.append(f"  {bullet['text']}")
    return "\n".join(lines)


def _resume_plain(sections: list[dict[str, Any]]) -> str:
    parts = []
    for section in sections:
        parts.append(section.get("name") or "Section")
        if section.get("body_text"):
            parts.append(section["body_text"])
        for bullet in section.get("bullets") or []:
            parts.append(f"- {bullet.get('text')}")
    return "\n".join(parts)


def _apply_edits(sections: list[dict[str, Any]], edits: dict[int, str]) -> int:
    """Write model edits onto the lines they were offered for, and nowhere else."""
    applied = 0
    for section in sections:
        if not section.get("editable", True):
            continue
        for bullet in section.get("bullets") or []:
            if not bullet.get("editable", True) or bullet["id"] not in edits:
                continue
            _set_bullet_text(bullet, edits[bullet["id"]])
            applied += 1
    return applied


def _set_bullet_text(bullet: dict[str, Any], text: str) -> None:
    bullet["text"] = text
    original = bullet.get("latex_original") or ""
    if original:
        bullet["latex_source"] = rf"\item {escape_latex_text(text)}"


@router.post("/runs", response_model=TailorRunRead)
def create_run(
    payload: TailorCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ResumeStorage = Depends(get_resume_storage),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> TailorRunRead:
    job = SqlAlchemyJobRepo(db).get(payload.job_id)
    resume = SqlAlchemyResumeRepo(db).get(payload.resume_id)
    if not job or job.user_id != current_user.id:
        raise not_found("Job not found")
    if not resume or resume.user_id != current_user.id:
        raise not_found("Resume not found")

    sections = _sections_snapshot(resume, db, storage)
    cover_letter = None
    if payload.do_tailor:
        edits, cover_letter = run_line_tailor_and_cover_letter(
            job.raw_text,
            _editable_items(sections),
            _resume_plain(sections),
            gateway,
            frozen_context=_frozen_context(sections),
            instructions=payload.personalized_instructions,
        )
        _apply_edits(sections, edits)

    run = TailorRun(
        user_id=current_user.id,
        job_id=job.id,
        resume_id=resume.id,
        status="ready",
        do_tailor=payload.do_tailor,
        personalized_instructions=payload.personalized_instructions or None,
        sections_json=json.dumps(sections),
        cover_letter=cover_letter,
    )
    created = SqlAlchemyTailorRunRepo(db).create(run)
    return TailorRunRead.model_validate(created)


@router.get("/runs/{run_id}", response_model=TailorRunRead)
def get_run(
    run_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TailorRunRead:
    run = SqlAlchemyTailorRunRepo(db).get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Tailor run not found")
    return TailorRunRead.model_validate(run)


def _load(run_id: int, current_user, db: Session) -> tuple[Any, list[dict[str, Any]]]:
    repo = SqlAlchemyTailorRunRepo(db)
    run = repo.get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Tailor run not found")
    return run, json.loads(run.sections_json or "[]")


@router.patch("/runs/{run_id}/sections/{section_id}", response_model=TailorRunRead)
def patch_section(
    run_id: int,
    section_id: int,
    payload: SectionPatch,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TailorRunRead:
    repo = SqlAlchemyTailorRunRepo(db)
    run, sections = _load(run_id, current_user, db)
    target = next((s for s in sections if s.get("id") == section_id), None)
    if target is None:
        raise not_found("Section not found")
    if not target.get("editable", True):
        raise bad_request(
            f"Section '{target.get('name')}' is frozen ({target.get('frozen_reason')})"
        )
    data = payload.model_dump(exclude_unset=True)
    # A section's name, header, and locators define where its text sits in the
    # source document; only the text itself may be edited.
    for key in ("body_text", "latex_source"):
        if data.get(key) is not None:
            target[key] = data[key]
    if data.get("bullets") is not None:
        _patch_bullets(target, data["bullets"])
    run.sections_json = json.dumps(sections)
    run.status = "ready"
    run.final_docx_key = None
    run.final_pdf_key = None
    run.final_tex_key = None
    run.cover_document_key = None
    run.cover_pdf_key = None
    run.updated_at = datetime.utcnow()
    return TailorRunRead.model_validate(repo.update(run))


def _patch_bullets(section: dict[str, Any], incoming: list[dict[str, Any]]) -> None:
    by_id = {bullet["id"]: bullet for bullet in section.get("bullets") or []}
    for item in incoming:
        existing = by_id.get(item.get("id"))
        if existing is None or not existing.get("editable", True):
            continue
        text = (item.get("text") or "").strip()
        if text:
            _set_bullet_text(existing, text)


@router.post(
    "/runs/{run_id}/sections/{section_id}/rewrite", response_model=TailorRunRead
)
def rewrite_section(
    run_id: int,
    section_id: int,
    payload: RewriteRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> TailorRunRead:
    repo = SqlAlchemyTailorRunRepo(db)
    run, sections = _load(run_id, current_user, db)
    job = SqlAlchemyJobRepo(db).get(run.job_id)
    if not job:
        raise not_found("Job not found")
    target = next((s for s in sections if s.get("id") == section_id), None)
    if target is None:
        raise not_found("Section not found")
    if not target.get("editable", True):
        raise bad_request(
            f"Section '{target.get('name')}' is frozen ({target.get('frozen_reason')})"
        )

    bullets = target.get("bullets") or []
    if payload.bullet_index is not None:
        if payload.bullet_index < 0 or payload.bullet_index >= len(bullets):
            raise bad_request("bullet_index out of range")
        bullet = bullets[payload.bullet_index]
        if not bullet.get("editable", True):
            raise bad_request(f"That line is frozen ({bullet.get('frozen_reason')})")
        rewritten = gateway.generate(
            "bullet_rewrite",
            build_bullet_rewrite_prompt(
                job.raw_text,
                target.get("name") or "",
                bullet.get("text") or "",
                payload.instructions,
            ),
        ).text.strip()
        if rewritten:
            _set_bullet_text(bullet, rewritten)
    elif bullets:
        # A section's text lives in its lines, so rewrite them one by one rather
        # than replacing the section with a blob that has nowhere to go.
        for bullet in bullets:
            if not bullet.get("editable", True):
                continue
            rewritten = gateway.generate(
                "bullet_rewrite",
                build_bullet_rewrite_prompt(
                    job.raw_text,
                    target.get("name") or "",
                    bullet.get("text") or "",
                    payload.instructions,
                ),
            ).text.strip()
            if rewritten:
                _set_bullet_text(bullet, rewritten)
    else:
        rewritten = gateway.generate(
            "bullet_rewrite",
            build_section_rewrite_prompt(
                job.raw_text,
                target.get("name") or "",
                target.get("body_text") or "",
                payload.instructions,
            ),
        ).text.strip()
        if rewritten:
            target["body_text"] = rewritten
            target["latex_source"] = escape_latex_text(rewritten)

    target["body_text"] = (
        "\n".join(b.get("text") or "" for b in bullets)
        if bullets
        else target.get("body_text", "")
    )
    run.sections_json = json.dumps(sections)
    run.status = "ready"
    run.final_docx_key = None
    run.final_pdf_key = None
    run.final_tex_key = None
    run.cover_document_key = None
    run.cover_pdf_key = None
    run.updated_at = datetime.utcnow()
    return TailorRunRead.model_validate(repo.update(run))


@router.post("/runs/{run_id}/finalize", response_model=TailorRunRead)
def finalize_run(
    run_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ResumeStorage = Depends(get_resume_storage),
) -> TailorRunRead:
    repo = SqlAlchemyTailorRunRepo(db)
    run, sections = _load(run_id, current_user, db)
    resume = SqlAlchemyResumeRepo(db).get(run.resume_id)
    if not resume:
        raise not_found("Resume not found")

    if resume.source_format not in {"docx", "tex"}:
        raise bad_request(
            "Layout-preserving tailoring needs the original DOCX or LaTeX source"
        )
    if resume.source_format == "docx":
        rendered = render_docx_from_sections(
            _read_original(resume, storage), sections, f"tailor_{run.id}"
        )
        run.final_docx_key = rendered.docx_path
        run.final_pdf_key = rendered.pdf_path
        run.compiler_warning = rendered.warning
        run.final_latex = None
    else:
        from app.modules.documents.renderer import LatexPdfRenderer

        latex = _read_original(resume, storage).decode("utf-8")
        for section in sections:
            for bullet in section.get("bullets", []):
                old, new = bullet.get("latex_original"), bullet.get("latex_source")
                if bullet.get("editable", True) and old and new and old != new:
                    if latex.count(old) != 1:
                        raise bad_request(
                            "Ambiguous LaTeX line locator; review the source before finalizing"
                        )
                    latex = latex.replace(old, new, 1)
        result = LatexPdfRenderer().render(latex, f"tailor_{run.id}")
        with open(result.tex_path, encoding="utf-8") as handle:
            run.final_latex = handle.read()
        run.final_tex_key = result.tex_path
        run.final_pdf_key = result.pdf_path
        run.compiler_warning = result.warning
    if run.cover_letter:
        from app.modules.documents.cover import render_cover_docx, render_cover_tex

        if resume.source_format == "docx":
            template = (
                Path(run.cover_template_key).read_bytes()
                if run.cover_template_key
                else None
            )
            run.cover_document_key = render_cover_docx(
                _read_original(resume, storage),
                run.cover_letter,
                str(Path(run.final_docx_key).with_name(f"cover_{run.id}.docx")),
                template=template,
            )
            from app.modules.documents.pdf import docx_to_pdf
            from app.core.config import get_settings

            run.cover_pdf_key, _ = docx_to_pdf(
                run.cover_document_key,
                str(Path(run.cover_document_key).with_suffix(".pdf")),
                converter=get_settings().docx_pdf_converter,
            )
        else:
            from app.modules.documents.renderer import LatexPdfRenderer

            cover_tex = str(Path(run.final_tex_key).with_name(f"cover_{run.id}.tex"))
            render_cover_tex(
                _read_original(resume, storage).decode("utf-8"),
                run.cover_letter,
                cover_tex,
            )
            letter = LatexPdfRenderer().render(
                Path(cover_tex).read_text(), f"cover_{run.id}"
            )
            run.cover_document_key = letter.pdf_path
            if not letter.pdf_path:
                run.compiler_warning = (
                    run.compiler_warning or ""
                ) + " | Cover letter PDF requires a LaTeX compiler."
    run.status = "finalized"
    run.updated_at = datetime.utcnow()
    return TailorRunRead.model_validate(repo.update(run))


@router.post("/runs/{run_id}/auto-apply", response_model=TailorRunRead)
def auto_apply_run(
    run_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ResumeStorage = Depends(get_resume_storage),
) -> TailorRunRead:
    """Move a finalized run to auto-apply, file its documents, and log the tracker row.

    The resume family decides the folder, so a tailored data science resume lands
    in the data science folder without the caller choosing a path.
    """
    repo = SqlAlchemyTailorRunRepo(db)
    run, _sections = _load(run_id, current_user, db)
    if run.status != "finalized":
        finalize_run(run_id, current_user=current_user, db=db, storage=storage)
        run = repo.get(run_id)
    resume = SqlAlchemyResumeRepo(db).get(run.resume_id)
    job = SqlAlchemyJobRepo(db).get(run.job_id)
    if not resume or not job:
        raise not_found("Resume or job not found")

    exported = export_to_library(
        resume.family,
        export_stem(resume.original_filename, job.company_name, job.role, job.id),
        docx_path=run.final_docx_key,
        pdf_path=run.final_pdf_key,
        tex_path=run.final_tex_key,
        warnings=[run.compiler_warning] if run.compiler_warning else [],
    )
    if not any((exported.docx_path, exported.pdf_path, exported.tex_path)):
        raise bad_request("Nothing to export: finalize produced no document")

    run.status = "auto_apply"
    run.export_dir = exported.directory
    run.exported_docx_path = exported.docx_path
    run.exported_pdf_path = exported.pdf_path
    run.exported_tex_path = exported.tex_path
    run.updated_at = datetime.utcnow()
    saved = repo.update(run)

    upsert_application(
        db,
        user_id=current_user.id,
        job=job,
        resume=resume,
        status="auto_apply",
        tailor_run_id=run.id,
        resume_tailored=run.do_tailor,
        document_path=exported.docx_path or exported.tex_path,
    )
    return TailorRunRead.model_validate(saved)


class CoverPatch(BaseModel):
    text: str = Field(min_length=1, max_length=12000)


@router.patch("/runs/{run_id}/cover-letter", response_model=TailorRunRead)
def edit_cover(
    run_id: int,
    payload: CoverPatch,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run, _ = _load(run_id, current_user, db)
    run.cover_letter = payload.text
    run.cover_document_key = run.cover_pdf_key = None
    run.status = "ready"
    run.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return TailorRunRead.model_validate(run)


@router.post("/runs/{run_id}/cover-template", response_model=TailorRunRead)
def cover_template(
    run_id: int,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.core.config import get_settings
    from app.modules.documents.cover import render_cover_docx

    run, _ = _load(run_id, current_user, db)
    data = file.file.read(get_settings().max_upload_size_mb * 1024 * 1024 + 1)
    if len(data) > get_settings().max_upload_size_mb * 1024 * 1024 or not (
        file.filename or ""
    ).lower().endswith(".docx"):
        raise bad_request("Upload a DOCX template within the configured size limit")
    path = Path(get_settings().output_dir) / f"letter_template_{run.id}.docx"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        render_cover_docx(
            data, "Cover preview", str(path.with_suffix(".preview.docx")), template=data
        )
    except Exception:
        raise bad_request(
            "Template must be a readable DOCX containing {{cover_letter}} in body text"
        )
    path.write_bytes(data)
    run.cover_template_key = str(path)
    run.cover_document_key = run.cover_pdf_key = None
    run.status = "ready"
    run.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return TailorRunRead.model_validate(run)
