from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyJobRepo
from app.core.deps import get_current_user, get_db
from app.modules.jobs.models import Job
from app.modules.jobs.schemas import JobIngestRequest, JobRead


router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("/ingest", response_model=JobRead)
def ingest_job(
    payload: JobIngestRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JobRead:
    repo = SqlAlchemyJobRepo(db)
    job = Job(user_id=current_user.id, raw_text=payload.raw_text)
    created = repo.create(job)
    return JobRead.model_validate(created)
