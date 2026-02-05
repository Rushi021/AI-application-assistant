import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyPipelineRunRepo, SqlAlchemyResumeRepo
from app.common.docx_service import apply_tailored_sections, build_sectioned_resume_text, parse_docx
from app.common.errors import not_found
from app.common.ports import LLMProvider, ResumeStorage
from app.core.deps import get_current_user, get_db, get_llm_provider, get_resume_storage
from app.modules.ai.orchestrator import run_tailor_and_cover_letter
from app.modules.pipeline.models import PipelineRun
from app.modules.pipeline.schemas import PipelineRunCreate, PipelineRunRead

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/pipeline", tags=["pipeline"])


def _get_resume_text_and_sectioned(
    payload: PipelineRunCreate,
    resume_storage: ResumeStorage,
    resume_repo: SqlAlchemyResumeRepo,
    current_user_id: int,
) -> tuple[str, str | None, int | None]:
    """Resolve resume text and optional sectioned text + num_paragraphs. Raises if invalid."""
    if payload.resume_id is not None:
        resume = resume_repo.get(payload.resume_id)
        if not resume or resume.user_id != current_user_id:
            raise not_found("Resume not found")
        try:
            file_bytes = resume_storage.get_file_bytes(resume.file_key)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot read resume file: {e!s}",
            ) from e
        parse_result = parse_docx(file_bytes)
        resume_text = parse_result.plain_text
        if parse_result.num_paragraphs > 0:
            sectioned = build_sectioned_resume_text(parse_result)
            return resume_text, sectioned, parse_result.num_paragraphs
        return resume_text, None, None
    if payload.resume_text:
        return payload.resume_text, None, None
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Provide either resume_text or resume_id",
    )


@router.post("/run", response_model=PipelineRunRead)
def create_run(
    payload: PipelineRunCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> PipelineRunRead:
    resume_repo = SqlAlchemyResumeRepo(db)
    resume_text, sectioned_resume_text, num_paragraphs = _get_resume_text_and_sectioned(
        payload, resume_storage, resume_repo, current_user.id
    )
    repo = SqlAlchemyPipelineRunRepo(db)
    run = PipelineRun(
        user_id=current_user.id,
        status="running",
        job_description=payload.job_description,
        resume_text=resume_text,
        resume_id=payload.resume_id,
    )
    created = repo.create(run)
    try:
        tailored_resume, tailored_sections_json, cover_letter = run_tailor_and_cover_letter(
            payload.job_description,
            resume_text,
            llm,
            tailor_instructions=payload.tailor_instructions,
            cover_letter_instructions=payload.cover_letter_instructions,
            sectioned_resume_text=sectioned_resume_text,
            num_paragraphs=num_paragraphs,
        )
        repo.update_results(
            created.id,
            status="completed",
            tailored_resume=tailored_resume,
            tailored_sections=tailored_sections_json,
            cover_letter=cover_letter,
        )
    except HTTPException:
        repo.update_results(created.id, status="failed")
        raise
    except Exception as e:
        logger.exception("Pipeline run failed")
        repo.update_results(created.id, status="failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Pipeline failed: {type(e).__name__}: {e!s}",
        ) from e
    updated = repo.get(created.id)
    return PipelineRunRead.model_validate(updated)


@router.get("/runs/{run_id}", response_model=PipelineRunRead)
def get_run(
    run_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PipelineRunRead:
    repo = SqlAlchemyPipelineRunRepo(db)
    run = repo.get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Pipeline run not found")
    return PipelineRunRead.model_validate(run)


@router.get("/runs/{run_id}/apply-doc", response_class=Response)
def apply_doc(
    run_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> Response:
    """
    After you approve the tailored resume, call this to get the Word document
    with edits applied. Format, font, and spacing are preserved.
    Requires that the run was created with resume_id and has tailored_sections.
    """
    repo = SqlAlchemyPipelineRunRepo(db)
    run = repo.get(run_id)
    if not run or run.user_id != current_user.id:
        raise not_found("Pipeline run not found")
    if not run.resume_id or not run.tailored_sections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This run has no Word resume or tailored sections; use a run created with resume_id",
        )
    resume_repo = SqlAlchemyResumeRepo(db)
    resume = resume_repo.get(run.resume_id)
    if not resume or resume.user_id != current_user.id:
        raise not_found("Resume not found")
    file_bytes = resume_storage.get_file_bytes(resume.file_key)
    sections = json.loads(run.tailored_sections)
    out_bytes = apply_tailored_sections(file_bytes, sections)
    filename = f"tailored_{resume.original_filename}"
    if not filename.lower().endswith(".docx"):
        filename += ".docx"
    return Response(
        content=out_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
