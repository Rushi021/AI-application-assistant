from datetime import datetime
import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import (
    SqlAlchemyJobRepo,
    SqlAlchemyResumeRepo,
    SqlAlchemyResumeSectionRepo,
    SqlAlchemyTailorRunRepo,
)
from app.common.errors import bad_request, not_found
from app.core.deps import get_current_user, get_db, get_model_gateway
from app.modules.ai.gateway import ModelGateway
from app.modules.ai.orchestrator import run_tailor_and_cover_letter
from app.modules.ai.prompts.pipeline import build_bullet_rewrite_prompt, build_section_rewrite_prompt
from app.modules.documents.renderer import render_from_sections
from app.modules.tailoring.models import TailorRun
from app.modules.tailoring.schemas import RewriteRequest, SectionPatch, TailorCreate, TailorRunRead

router = APIRouter(prefix="/tailoring", tags=["tailoring"])


def _sections_snapshot(resume_id: int, db: Session) -> list[dict[str, Any]]:
    sections = SqlAlchemyResumeSectionRepo(db).list_sections(resume_id)
    return [
        {
            "id": section.id,
            "name": section.name,
            "order_index": section.order_index,
            "body_text": section.body_text,
            "latex_source": section.latex_source,
            "bullets": [
                {"id": b.id, "order_index": b.order_index, "text": b.text, "latex_source": b.latex_source}
                for b in section.bullets
            ],
        }
        for section in sections
    ]


def _resume_plain(sections: list[dict[str, Any]]) -> str:
    parts = []
    for section in sections:
        parts.append(section.get("name") or "Section")
        if section.get("body_text"):
            parts.append(section["body_text"])
        for bullet in section.get("bullets") or []:
            parts.append(f"- {bullet.get('text')}")
    return "\n".join(parts)


@router.post("/runs", response_model=TailorRunRead)
def create_run(
    payload: TailorCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> TailorRunRead:
    job = SqlAlchemyJobRepo(db).get(payload.job_id)
    resume = SqlAlchemyResumeRepo(db).get(payload.resume_id)
    if not job or job.user_id != current_user.id:
        raise not_found("Job not found")
    if not resume or resume.user_id != current_user.id:
        raise not_found("Resume not found")

    sections = _sections_snapshot(resume.id, db)
    cover_letter = None
    if payload.do_tailor:
        tailored, cover_letter = run_tailor_and_cover_letter(
            job.raw_text,
            _resume_plain(sections),
            gateway,
            instructions=payload.personalized_instructions,
        )
        if sections:
            sections[-1]["body_text"] = tailored
            sections[-1]["latex_source"] = tailored
        else:
            sections = [
                {
                    "id": 0,
                    "name": "tailored",
                    "order_index": 0,
                    "body_text": tailored,
                    "latex_source": tailored,
                    "bullets": [],
                }
            ]

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


@router.patch("/runs/{run_id}/sections/{section_id}", response_model=TailorRunRead)
def patch_section(
    run_id: int,
    section_id: int,
    payload: SectionPatch,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TailorRunRead:
    repo = SqlAlchemyTailorRunRepo(db)
    run = repo.get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Tailor run not found")
    sections = json.loads(run.sections_json or "[]")
    target = next((s for s in sections if s.get("id") == section_id), None)
    if target is None:
        raise not_found("Section not found")
    data = payload.model_dump(exclude_unset=True)
    target.update({k: v for k, v in data.items() if v is not None})
    run.sections_json = json.dumps(sections)
    run.updated_at = datetime.utcnow()
    return TailorRunRead.model_validate(repo.update(run))


@router.post("/runs/{run_id}/sections/{section_id}/rewrite", response_model=TailorRunRead)
def rewrite_section(
    run_id: int,
    section_id: int,
    payload: RewriteRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> TailorRunRead:
    repo = SqlAlchemyTailorRunRepo(db)
    run = repo.get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Tailor run not found")
    job = SqlAlchemyJobRepo(db).get(run.job_id)
    if not job:
        raise not_found("Job not found")
    sections = json.loads(run.sections_json or "[]")
    target = next((s for s in sections if s.get("id") == section_id), None)
    if target is None:
        raise not_found("Section not found")
    if payload.bullet_index is not None:
        bullets = target.get("bullets") or []
        if payload.bullet_index < 0 or payload.bullet_index >= len(bullets):
            raise bad_request("bullet_index out of range")
        original = bullets[payload.bullet_index].get("text") or ""
        rewritten = gateway.generate(
            "bullet_rewrite",
            build_bullet_rewrite_prompt(job.raw_text, target.get("name") or "", original, payload.instructions),
        ).text
        bullets[payload.bullet_index]["text"] = rewritten
        bullets[payload.bullet_index]["latex_source"] = rf"\item {rewritten}"
        target["bullets"] = bullets
    else:
        rewritten = gateway.generate(
            "bullet_rewrite",
            build_section_rewrite_prompt(
                job.raw_text,
                target.get("name") or "",
                target.get("body_text") or "",
                payload.instructions,
            ),
        ).text
        target["body_text"] = rewritten
        target["latex_source"] = rewritten
    run.sections_json = json.dumps(sections)
    run.updated_at = datetime.utcnow()
    return TailorRunRead.model_validate(repo.update(run))


@router.post("/runs/{run_id}/finalize", response_model=TailorRunRead)
def finalize_run(
    run_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TailorRunRead:
    repo = SqlAlchemyTailorRunRepo(db)
    run = repo.get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Tailor run not found")
    resume = SqlAlchemyResumeRepo(db).get(run.resume_id)
    sections = json.loads(run.sections_json or "[]")
    preamble = (resume.template_preamble if resume else "") or ""
    result = render_from_sections(preamble, sections, f"tailor_{run.id}")
    run.final_latex = open(result.tex_path, encoding="utf-8").read()
    run.final_pdf_key = result.pdf_path
    run.compiler_warning = result.warning
    run.status = "finalized"
    run.updated_at = datetime.utcnow()
    return TailorRunRead.model_validate(repo.update(run))
