from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyPipelineRunRepo
from app.common.errors import not_found
from app.common.ports import LLMProvider
from app.core.deps import get_current_user, get_db, get_llm_provider
from app.modules.ai.orchestrator import run_tailor_and_cover_letter
from app.modules.pipeline.models import PipelineRun
from app.modules.pipeline.schemas import PipelineRunCreate, PipelineRunRead


router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.post("/run", response_model=PipelineRunRead)
def create_run(
    payload: PipelineRunCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
) -> PipelineRunRead:
    repo = SqlAlchemyPipelineRunRepo(db)
    run = PipelineRun(
        user_id=current_user.id,
        status="running",
        job_description=payload.job_description,
        resume_text=payload.resume_text,
    )
    created = repo.create(run)
    try:
        tailored_resume, cover_letter = run_tailor_and_cover_letter(
            payload.job_description,
            payload.resume_text,
            llm,
        )
        repo.update_results(
            created.id,
            status="completed",
            tailored_resume=tailored_resume,
            cover_letter=cover_letter,
        )
    except Exception:
        repo.update_results(created.id, status="failed")
        raise
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
