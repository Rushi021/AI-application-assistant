from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyPipelineRunRepo
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db
from app.modules.pipeline.models import PipelineRun
from app.modules.pipeline.schemas import PipelineRunCreate, PipelineRunRead


router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.post("/run", response_model=PipelineRunRead)
def create_run(
    payload: PipelineRunCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PipelineRunRead:
    repo = SqlAlchemyPipelineRunRepo(db)
    run = PipelineRun(user_id=current_user.id, status="queued")
    created = repo.create(run)
    return PipelineRunRead.model_validate(created)


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
