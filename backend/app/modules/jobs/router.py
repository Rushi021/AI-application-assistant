from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyJobRepo
from app.core.deps import get_db, get_request_scope
from app.core.security import RequestScope
from app.modules.jobs.models import Job
from app.modules.jobs.schemas import JobIngestRequest, JobRead


router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("/ingest", response_model=JobRead)
def ingest_job(
    payload: JobIngestRequest,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> JobRead:
    repo = SqlAlchemyJobRepo(db)
    job = Job(
        session_id=scope.session_id,
        user_id=scope.user_id,
        raw_text=payload.raw_text,
    )
    created = repo.create(job)
    return JobRead.model_validate(created)
