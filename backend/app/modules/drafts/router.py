"""Draft workflow router: create, get, section chat, patch, apply-section, apply-all."""

import io
import json
import logging
import os
import re
from datetime import datetime

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyPipelineRunRepo, SqlAlchemyResumeRepo
from app.common.errors import not_found
from app.common.ports import LLMProvider, ResumeStorage
from app.common.resume_parser import parse_resume_to_json
from app.core.config import get_settings
from app.core.deps import get_db, get_llm_provider, get_request_scope, get_resume_storage
from app.core.security import RequestScope
from app.modules.ai.prompts.pipeline import build_cover_letter_prompt
from app.modules.ai.prompts.section_chat import build_section_chat_prompt
from app.modules.drafts.models import ResumeDraft, ResumeDraftSection, SectionChatMessage
from app.modules.drafts.repos import DraftRepo, DraftSectionRepo, SectionChatRepo
from app.modules.drafts.schemas import (
    ChatMessageRead,
    DraftCreate,
    DraftRead,
    GenerateCoverLetterRequest,
    GenerateCoverLetterResponse,
    SectionChatRequest,
    SectionChatResponse,
    SectionPatchRequest,
    SectionRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/drafts", tags=["drafts"])


# ---------------------------------------------------------------------------
# Docx reconstruction helpers
# ---------------------------------------------------------------------------

def _copy_run_font(source_font, target_font) -> None:
    """Copy font properties from source to target.

    Font.color is read-only in python-docx; it must be set via .color.rgb, not setattr.
    We copy settable attributes first, then copy color via ColorFormat.rgb when present.
    """
    for attr in ("bold", "italic", "underline", "size", "name"):
        if hasattr(source_font, attr):
            val = getattr(source_font, attr)
            if val is not None and hasattr(target_font, attr):
                try:
                    setattr(target_font, attr, val)
                except (AttributeError, TypeError):
                    pass
    # Font.color has no setter; copy via .color.rgb to avoid AttributeError
    try:
        if hasattr(source_font, "color") and source_font.color is not None:
            src_rgb = getattr(source_font.color, "rgb", None)
            if src_rgb is not None and hasattr(target_font, "color") and target_font.color is not None:
                target_font.color.rgb = src_rgb
    except (AttributeError, TypeError):
        pass


def _apply_fmt_to_run(run, fmt: dict) -> None:
    """Apply stored JSON formatting to a docx run."""
    if not fmt:
        return
    if fmt.get("bold") is not None:
        run.bold = fmt["bold"]
    if fmt.get("italic") is not None:
        run.italic = fmt["italic"]
    if fmt.get("underline") is not None:
        run.underline = fmt["underline"]
    if fmt.get("font_name"):
        run.font.name = fmt["font_name"]
    if fmt.get("font_size_pt") is not None:
        from docx.shared import Pt
        run.font.size = Pt(fmt["font_size_pt"])


def _build_cover_letter_docx(
    header_text: str,
    body_text: str,
    parsed_json: dict | None = None,
    header_para_start: int | None = None,
    header_para_end: int | None = None,
) -> bytes:
    """
    Build a deterministic .docx cover letter:
    - Centered resume-like header (name + contact) with title size 18
    - Date line
    - Salutation
    - Body paragraphs
    - Closing + signature

    LLM output is sanitized into body paragraphs so formatting remains stable.
    """
    def _normalize_whitespace(text: str) -> str:
        return re.sub(r"\s+", " ", text or "").strip()

    def _normalize_header(header: str) -> tuple[str, str]:
        raw_lines = [ln.strip() for ln in (header or "").split("\n") if ln.strip()]
        if not raw_lines:
            return ("", "")
        name_line = _normalize_whitespace(raw_lines[0])
        contact_chunks: list[str] = []
        for ln in raw_lines[1:]:
            ln = ln.replace("\t", " | ")
            for part in [p.strip() for p in ln.split("|") if p.strip()]:
                contact_chunks.append(_normalize_whitespace(part))
        # De-duplicate while preserving order.
        seen: set[str] = set()
        deduped = [c for c in contact_chunks if not (c in seen or seen.add(c))]
        return (name_line, " | ".join(deduped))

    def _looks_like_date_line(line: str) -> bool:
        s = (line or "").strip()
        return bool(
            re.match(r"^date\s*:", s, flags=re.IGNORECASE)
            or re.match(r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$", s)
        )

    def _format_signature_name(name: str) -> str:
        n = _normalize_whitespace(name)
        if not n:
            return ""
        # Resume headers are often uppercase; convert to proper-case for signature.
        if n.upper() == n:
            return " ".join(token.capitalize() for token in n.split())
        return n

    def _normalize_cover_letter_body(raw_text: str, fallback_name: str) -> tuple[str, list[str], str, str]:
        """
        Returns:
        salutation, body_paragraphs, closing_line, signature_line
        """
        text = (raw_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            return ("Dear Hiring Manager,", [], "Sincerely,", _format_signature_name(fallback_name))

        lines = [ln.strip() for ln in text.split("\n")]
        # Trim leading/trailing empty lines first.
        while lines and not lines[0]:
            lines.pop(0)
        while lines and not lines[-1]:
            lines.pop()

        salutation = "Dear Hiring Manager,"
        if lines and _looks_like_date_line(lines[0]):
            lines.pop(0)
            while lines and not lines[0]:
                lines.pop(0)

        if lines and re.match(r"^dear\b", lines[0], flags=re.IGNORECASE):
            salutation = lines.pop(0).rstrip()
            while lines and not lines[0]:
                lines.pop(0)

        closing_line = "Sincerely,"
        signature_line = _format_signature_name(fallback_name)
        closing_pattern = re.compile(
            r"^(sincerely|best regards|regards|thank you|thanks)[,!\.]?$",
            flags=re.IGNORECASE,
        )

        closing_idx = None
        for i in range(len(lines) - 1, -1, -1):
            if closing_pattern.match(lines[i] or ""):
                closing_idx = i
                break

        if closing_idx is not None:
            closing_line = lines[closing_idx].rstrip(",.!") + ","
            if closing_idx + 1 < len(lines):
                candidate_sig = _normalize_whitespace(lines[closing_idx + 1])
                if candidate_sig:
                    signature_line = candidate_sig
            lines = lines[:closing_idx]

        body_block = "\n".join(lines).strip()
        body_paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body_block) if p.strip()]

        # Guard against malformed output still containing salutation/closing markers.
        if body_paragraphs and re.match(r"^dear\b", body_paragraphs[0], flags=re.IGNORECASE):
            body_paragraphs = body_paragraphs[1:]
        while body_paragraphs and closing_pattern.match(body_paragraphs[-1]):
            body_paragraphs.pop()

        return (salutation, body_paragraphs, closing_line, signature_line)

    doc = Document()

    # Base paragraph font for deterministic output.
    normal_style = doc.styles["Normal"]
    normal_style.font.name = "Times New Roman"
    normal_style.font.size = Pt(12)

    name_line, contact_line = _normalize_header(header_text)

    if name_line:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(name_line)
        run.bold = True
        run.font.name = "Times New Roman"
        run.font.size = Pt(18)  # Requested cover letter title size.

    if contact_line:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(contact_line)
        run.font.name = "Times New Roman"
        run.font.size = Pt(12)

    doc.add_paragraph("")

    date_para = doc.add_paragraph()
    d1 = date_para.add_run("Date:")
    d1.bold = True
    d1.font.name = "Times New Roman"
    d1.font.size = Pt(12)
    d2 = date_para.add_run(f" {datetime.now().strftime('%m/%d/%y')}")
    d2.font.name = "Times New Roman"
    d2.font.size = Pt(12)

    doc.add_paragraph("")

    salutation, body_paragraphs, closing_line, signature_line = _normalize_cover_letter_body(
        body_text,
        name_line,
    )

    doc.add_paragraph(salutation or "Dear Hiring Manager,")
    doc.add_paragraph("")

    for para_text in body_paragraphs:
        doc.add_paragraph(para_text)
        doc.add_paragraph("")

    doc.add_paragraph(closing_line or "Sincerely,")
    if signature_line:
        doc.add_paragraph(signature_line)

    out = io.BytesIO()
    doc.save(out)
    out.seek(0)
    return out.read()


def _apply_sections_to_docx(
    file_bytes: bytes,
    sections: list,
    parsed_json: dict | None = None,
) -> bytes:
    """
    Apply edited section text back to the original docx, using paragraph
    index ranges (para_start, para_end) stored on each section.

    Uses per-paragraph formatting from parsed_json when available;
    otherwise falls back to copying the first run's font from the original.
    """
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = list(doc.paragraphs)

    # Build a lookup: paragraph_index -> fmt dict from parsed_json
    para_fmt_lookup: dict[int, dict] = {}
    if parsed_json:
        for sec_json in parsed_json.get("sections", []):
            for p in sec_json.get("paragraphs", []):
                para_fmt_lookup[p["idx"]] = p.get("fmt", {})

    for sec in sections:
        if not sec.editable:
            continue

        para_start = sec.para_start
        para_end = sec.para_end
        if para_start is None or para_end is None:
            continue

        lines = sec.current_text.split("\n")
        target_paras = paragraphs[para_start:para_end]

        title_date_merge = (
            len(target_paras) == len(lines) + 1
            and lines
            and "\t" in lines[0]
        )

        for pi, para in enumerate(target_paras):
            if title_date_merge and pi == 1:
                new_text = ""
            elif title_date_merge and pi > 1:
                new_text = lines[pi - 1] if pi - 1 < len(lines) else ""
            elif title_date_merge and pi == 0:
                new_text = lines[0]
            else:
                new_text = lines[pi] if pi < len(lines) else ""
            abs_idx = para_start + pi

            if not para.text.strip() and not new_text:
                continue

            first_run = para.runs[0] if para.runs else None
            para.clear()

            if ":" in new_text and (first_run is not None or abs_idx in para_fmt_lookup):
                before_colon, after_colon = new_text.split(":", 1)
                run1 = para.add_run(before_colon + ":")
                run2 = para.add_run(after_colon)
                if first_run is not None:
                    _copy_run_font(first_run.font, run1.font)
                elif abs_idx in para_fmt_lookup:
                    _apply_fmt_to_run(run1, para_fmt_lookup[abs_idx])
                run2.font.bold = False
                if first_run is not None and first_run.font.size:
                    run2.font.size = first_run.font.size
                if first_run is not None and first_run.font.name:
                    run2.font.name = first_run.font.name
            else:
                new_run = para.add_run(new_text)
                if first_run is not None:
                    _copy_run_font(first_run.font, new_run.font)
                elif abs_idx in para_fmt_lookup:
                    _apply_fmt_to_run(new_run, para_fmt_lookup[abs_idx])

    out = io.BytesIO()
    doc.save(out)
    out.seek(0)
    return out.read()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=DraftRead)
def create_draft(
    payload: DraftCreate,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> DraftRead:
    """
    Create a draft from a base or tailored resume.
    Reads sections from the resume's stored parsed_json.
    """
    resume_repo = SqlAlchemyResumeRepo(db)
    resume = resume_repo.get_by_scope(scope.session_id, payload.base_resume_id)
    if not resume:
        raise not_found("Resume not found")

    # Validate pipeline run if tailored
    if payload.starting_source == "tailored" and payload.run_id:
        run_repo = SqlAlchemyPipelineRunRepo(db)
        run = run_repo.get_by_scope(scope.session_id, payload.run_id)
        if not run or not run.tailored_sections:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pipeline run has no tailored sections",
            )

    # Get canonical JSON sections
    if resume.parsed_json:
        parsed = json.loads(resume.parsed_json)
    else:
        # Fallback: parse on the fly and store for next time
        file_bytes = resume_storage.get_file_bytes(resume.file_key)
        parsed = parse_resume_to_json(file_bytes)
        resume.parsed_json = json.dumps(parsed)
        db.commit()

    raw_sections = parsed.get("sections", [])
    logger.info(
        "Draft create: %d sections from parsed_json (starting_source=%s)",
        len(raw_sections), payload.starting_source,
    )

    # If tailored, overlay tailored text by matching section_id
    if payload.starting_source == "tailored" and payload.run_id:
        run_repo = SqlAlchemyPipelineRunRepo(db)
        run = run_repo.get_by_scope(scope.session_id, payload.run_id)
        if run and run.tailored_sections:
            tailored = json.loads(run.tailored_sections)

            if isinstance(tailored, dict):
                # New format: {section_id: text}
                for sec in raw_sections:
                    if sec.get("editable", True) and sec["id"] in tailored:
                        logger.info(
                            "  Overlay section %s (%s): old=%d chars -> new=%d chars",
                            sec["id"], sec["title"],
                            len(sec.get("content", "")),
                            len(tailored[sec["id"]]),
                        )
                        sec["content"] = tailored[sec["id"]]
                    elif sec.get("editable", True):
                        logger.warning("  Section %s not found in tailored output", sec["id"])
            elif isinstance(tailored, list):
                # Legacy format: flat array — sequential overlay onto editable sections
                logger.warning("Using legacy flat-array tailored_sections overlay")
                editable_idx = 0
                for sec in raw_sections:
                    if sec.get("editable", True) and editable_idx < len(tailored):
                        sec["content"] = tailored[editable_idx]
                        editable_idx += 1

    # Create draft record
    draft_repo = DraftRepo(db)
    draft = ResumeDraft(
        session_id=scope.session_id,
        user_id=scope.user_id,
        run_id=payload.run_id,
        base_resume_id=payload.base_resume_id,
        starting_source=payload.starting_source,
        status="drafting",
        job_description=payload.job_description,
    )
    created_draft = draft_repo.create(draft)

    # Create section records from JSON
    section_repo = DraftSectionRepo(db)
    section_models = [
        ResumeDraftSection(
            draft_id=created_draft.id,
            section_id=sec["id"],
            section_title=sec["title"],
            order_index=sec["order"],
            original_text=sec.get("content", ""),
            current_text=sec.get("content", ""),
            editable=sec.get("editable", True),
            section_group=sec.get("group"),
            para_start=sec.get("para_start"),
            para_end=sec.get("para_end"),
        )
        for sec in raw_sections
    ]
    created_sections = section_repo.create_many(section_models)

    return DraftRead(
        id=created_draft.id,
        session_id=created_draft.session_id,
        run_id=created_draft.run_id,
        base_resume_id=created_draft.base_resume_id,
        starting_source=created_draft.starting_source,
        status=created_draft.status,
        job_description=created_draft.job_description,
        cover_letter=created_draft.cover_letter,
        created_at=created_draft.created_at,
        updated_at=created_draft.updated_at,
        sections=[SectionRead.model_validate(s) for s in created_sections],
    )


@router.get("/{draft_id}", response_model=DraftRead)
def get_draft(
    draft_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> DraftRead:
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    sections = section_repo.list_by_draft(draft_id)

    return DraftRead(
        id=draft.id,
        session_id=draft.session_id,
        run_id=draft.run_id,
        base_resume_id=draft.base_resume_id,
        starting_source=draft.starting_source,
        status=draft.status,
        job_description=draft.job_description,
        cover_letter=draft.cover_letter,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        sections=[SectionRead.model_validate(s) for s in sections],
    )


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> None:
    """Discard a draft and all of its section/chat history."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    db.query(SectionChatMessage).filter(
        SectionChatMessage.draft_id == draft_id,
    ).delete(synchronize_session=False)
    db.query(ResumeDraftSection).filter(
        ResumeDraftSection.draft_id == draft_id,
    ).delete(synchronize_session=False)
    db.delete(draft)
    db.commit()


@router.post("/{draft_id}/sections/{section_id}/chat", response_model=SectionChatResponse)
def chat_section(
    draft_id: int,
    section_id: str,
    payload: SectionChatRequest,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
) -> SectionChatResponse:
    """Per-section chat: user sends instruction, LLM returns revised text."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    section = section_repo.get_section(draft_id, section_id)
    if not section:
        raise not_found("Section not found")

    if not section.editable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This section is not editable",
        )

    # Record feedback if provided
    if payload.user_feedback:
        section_repo.set_feedback(draft_id, section_id, payload.user_feedback)

    chat_repo = SectionChatRepo(db)

    # Save user message
    chat_repo.add_message(draft_id, section_id, "user", payload.message)

    # Get history for context
    history = chat_repo.get_history(draft_id, section_id)
    history_for_prompt = history[:-1] if payload.include_history else []

    # Build prompt
    prompt = build_section_chat_prompt(
        section_title=section.section_title,
        current_text=section.current_text,
        job_description=draft.job_description,
        user_message=payload.message,
        user_feedback=payload.user_feedback,
        history=history_for_prompt,
    )

    try:
        revised_text = llm.generate(prompt)
    except Exception as e:
        logger.exception("Section chat LLM call failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM failed: {type(e).__name__}: {e!s}",
        ) from e

    # Save assistant response
    chat_repo.add_message(draft_id, section_id, "assistant", revised_text)

    # Update proposed_text
    section_repo.update_proposed(draft_id, section_id, revised_text)

    return SectionChatResponse(
        proposed_text=revised_text,
        assistant_message=revised_text,
    )


@router.patch("/{draft_id}/sections/{section_id}", response_model=SectionRead)
def patch_section(
    draft_id: int,
    section_id: str,
    payload: SectionPatchRequest,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> SectionRead:
    """Manual inline edit: replace current_text directly."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    updated = section_repo.update_current_text(draft_id, section_id, payload.current_text)
    if not updated:
        raise not_found("Section not found")

    # Record in chat history for traceability
    chat_repo = SectionChatRepo(db)
    chat_repo.add_message(
        draft_id, section_id, "system",
        "[Manual edit] User updated section text directly.",
    )

    return SectionRead.model_validate(updated)


@router.post("/{draft_id}/sections/{section_id}/apply", response_model=SectionRead)
def apply_section(
    draft_id: int,
    section_id: str,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> SectionRead:
    """Accept the proposed text for this section."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    updated = section_repo.accept_proposed(draft_id, section_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No proposed text to apply for this section",
        )
    return SectionRead.model_validate(updated)


@router.post("/{draft_id}/generate-cover-letter", response_model=GenerateCoverLetterResponse)
def generate_cover_letter(
    draft_id: int,
    payload: GenerateCoverLetterRequest = GenerateCoverLetterRequest(),
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> GenerateCoverLetterResponse:
    """
    Generate cover letter from the draft's finalized resume (all section current_text).
    Saves to draft and to output_cover_letter_path. Use after apply-all or for Regenerate.
    """
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")
    if not draft.job_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Draft has no job description; cannot generate cover letter",
        )

    section_repo = DraftSectionRepo(db)
    sections = section_repo.list_by_draft(draft_id)
    if not sections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Draft has no sections",
        )
    finalized_resume_text = "\n\n".join(s.current_text for s in sections)

    cover_letter_instructions = payload.cover_letter_instructions
    if cover_letter_instructions is None and draft.run_id:
        run_repo = SqlAlchemyPipelineRunRepo(db)
        run = run_repo.get_by_scope(scope.session_id, draft.run_id)
        if run:
            cover_letter_instructions = run.cover_letter_instructions

    prompt = build_cover_letter_prompt(
        draft.job_description,
        finalized_resume_text,
        cover_letter_instructions,
    )
    try:
        cover_letter = llm.generate(prompt) or ""
    except Exception as e:
        logger.exception("Cover letter LLM failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM failed: {type(e).__name__}: {e!s}",
        ) from e

    draft.cover_letter = cover_letter
    db.commit()
    db.refresh(draft)

    header_section = next(
        (s for s in sections if s.section_title == "Header" or s.section_group == "Header"),
        None,
    )
    header_text = header_section.current_text if header_section else ""
    parsed_json = None
    header_para_start = header_section.para_start if header_section else None
    header_para_end = header_section.para_end if header_section else None
    resume_repo = SqlAlchemyResumeRepo(db)
    resume = resume_repo.get_by_scope(scope.session_id, draft.base_resume_id)
    if resume and resume.parsed_json:
        parsed_json = json.loads(resume.parsed_json)

    docx_bytes = _build_cover_letter_docx(
        header_text=header_text,
        body_text=cover_letter,
        parsed_json=parsed_json,
        header_para_start=header_para_start,
        header_para_end=header_para_end,
    )
    settings = get_settings()
    cl_dir = settings.output_cover_letter_path
    os.makedirs(cl_dir, exist_ok=True)
    cl_filename = f"cover_letter_draft_{draft_id}.docx"
    cl_path = os.path.join(cl_dir, cl_filename)
    with open(cl_path, "wb") as f:
        f.write(docx_bytes)
    logger.info("Saved cover letter to %s", cl_path)

    return GenerateCoverLetterResponse(cover_letter=cover_letter)


def _apply_all_detail_from_error(e: BaseException) -> str:
    """Turn known errors into a clear message for the client."""
    msg = str(e).lower()
    if isinstance(e, OperationalError) and ("no such column" in msg or "undefined column" in msg):
        return (
            "Database schema is out of date. Run the migration from the backend folder: "
            "alembic upgrade head"
        )
    if "output_resume_path" in msg or "permission" in msg or "access" in msg:
        return "Cannot write resume to output folder. Check backend output_resume_path and permissions."
    return str(e)


@router.post("/{draft_id}/apply-all", response_class=Response)
def apply_all(
    draft_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> Response:
    """
    Finalize the draft: generate docx with all current_text applied,
    preserving the original Word formatting.
    Uses paragraph ranges (para_start, para_end) for precise mapping,
    with JSON formatting as a fallback.
    """
    try:
        draft_repo = DraftRepo(db)
        draft = draft_repo.get_by_scope(scope.session_id, draft_id)
        if not draft:
            raise not_found("Draft not found")

        section_repo = DraftSectionRepo(db)
        sections = section_repo.list_by_draft(draft_id)
        if not sections:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Draft has no sections",
            )

        resume_repo = SqlAlchemyResumeRepo(db)
        resume = resume_repo.get_by_scope(scope.session_id, draft.base_resume_id)
        if not resume:
            raise not_found("Base resume not found")

        parsed_json = json.loads(resume.parsed_json) if resume.parsed_json else None

        file_bytes = resume_storage.get_file_bytes(resume.file_key)
        out_bytes = _apply_sections_to_docx(file_bytes, sections, parsed_json)

        draft_repo.update_status(scope.session_id, draft_id, "approved")

        filename = f"final_{resume.original_filename}"
        if not filename.lower().endswith(".docx"):
            filename += ".docx"

        settings = get_settings()
        output_dir = settings.output_resume_path
        os.makedirs(output_dir, exist_ok=True)
        save_path = os.path.join(output_dir, filename)
        with open(save_path, "wb") as f:
            f.write(out_bytes)
        logger.info("Saved tailored resume to %s", save_path)

        return Response(
            content=out_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("apply_all failed for draft_id=%s", draft_id)
        detail = _apply_all_detail_from_error(e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail) from e


@router.get("/{draft_id}/sections/{section_id}/history", response_model=list[ChatMessageRead])
def get_section_history(
    draft_id: int,
    section_id: str,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> list[ChatMessageRead]:
    """Get the full chat history for a section."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    chat_repo = SectionChatRepo(db)
    messages = chat_repo.get_history(draft_id, section_id)
    return [ChatMessageRead.model_validate(m) for m in messages]
