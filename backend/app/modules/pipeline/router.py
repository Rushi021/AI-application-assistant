import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyPipelineRunRepo, SqlAlchemyResumeRepo
from app.common.errors import not_found
from app.common.ports import LLMProvider, ResumeStorage
from app.common.resume_parser import get_full_text, parse_resume_to_json
from app.core.deps import get_db, get_llm_provider, get_request_scope, get_resume_storage
from app.core.security import RequestScope
from app.modules.ai.orchestrator import run_tailor_only
from app.modules.pipeline.models import PipelineRun
from app.modules.pipeline.schemas import PipelineRunCreate, PipelineRunRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


def _get_resume_data(
    payload: PipelineRunCreate,
    resume_storage: ResumeStorage,
    resume_repo: SqlAlchemyResumeRepo,
    session_id: str,
) -> tuple[str, Optional[Dict[str, Any]]]:
    """
    Resolve resume plain text and parsed JSON from storage.

    Returns (resume_text, parsed_json_dict_or_none).
    """
    if payload.resume_id is not None:
        resume = resume_repo.get_by_scope(session_id, payload.resume_id)
        if not resume:
            raise not_found("Resume not found")

        # Use stored parsed_json if available
        if resume.parsed_json:
            parsed = json.loads(resume.parsed_json)
            resume_text = get_full_text(parsed)
            return resume_text, parsed

        # Fallback: parse on the fly
        try:
            file_bytes = resume_storage.get_file_bytes(resume.file_key)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot read resume file: {e!s}",
            ) from e
        parsed = parse_resume_to_json(file_bytes)
        resume_text = get_full_text(parsed)
        return resume_text, parsed

    if payload.resume_text:
        return payload.resume_text, None

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Provide either resume_text or resume_id",
    )


@router.post("/run", response_model=PipelineRunRead)
def create_run(
    payload: PipelineRunCreate,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> PipelineRunRead:
    resume_repo = SqlAlchemyResumeRepo(db)
    resume_text, parsed_json = _get_resume_data(
        payload, resume_storage, resume_repo, scope.session_id,
    )

    logger.info(
        "Pipeline run: resume_text=%d chars, parsed_json=%s",
        len(resume_text),
        f"{len(parsed_json.get('sections', []))} sections" if parsed_json else "None",
    )

    repo = SqlAlchemyPipelineRunRepo(db)
    run = PipelineRun(
        session_id=scope.session_id,
        user_id=scope.user_id,
        status="running",
        job_description=payload.job_description,
        resume_text=resume_text,
        resume_id=payload.resume_id,
        tailor_instructions=payload.tailor_instructions,
        cover_letter_instructions=payload.cover_letter_instructions,
    )
    created = repo.create(run)
    try:
        tailored_resume, tailored_sections_json = run_tailor_only(
            payload.job_description,
            resume_text,
            llm,
            tailor_instructions=payload.tailor_instructions,
            parsed_json=parsed_json,
        )
        repo.update_results(
            scope.session_id,
            created.id,
            status="completed",
            tailored_resume=tailored_resume,
            tailored_sections=tailored_sections_json,
            cover_letter=None,
        )
    except HTTPException:
        repo.update_results(scope.session_id, created.id, status="failed")
        raise
    except Exception as e:
        logger.exception("Pipeline run failed")
        repo.update_results(scope.session_id, created.id, status="failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Pipeline failed: {type(e).__name__}: {e!s}",
        ) from e
    updated = repo.get_by_scope(scope.session_id, created.id)
    return PipelineRunRead.model_validate(updated)


@router.get("/runs/{run_id}", response_model=PipelineRunRead)
def get_run(
    run_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> PipelineRunRead:
    repo = SqlAlchemyPipelineRunRepo(db)
    run = repo.get_by_scope(scope.session_id, run_id)
    if not run:
        raise not_found("Pipeline run not found")
    return PipelineRunRead.model_validate(run)
