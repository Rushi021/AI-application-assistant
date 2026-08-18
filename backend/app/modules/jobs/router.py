from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyJobRepo
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db
from app.modules.jobs.models import Job
from app.modules.jobs.schemas import JobIngestRequest, JobRead, JobUpdateRequest

router = APIRouter(prefix="/jobs", tags=["jobs"])

_ALLOWED_SOURCES = {"manual", "scraped", "captured"}


@router.post("/ingest", response_model=JobRead)
def ingest_job(
    payload: JobIngestRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JobRead:
    source = payload.source if payload.source in _ALLOWED_SOURCES else "manual"
    repo = SqlAlchemyJobRepo(db)
    job = Job(
        user_id=current_user.id,
        raw_text=payload.raw_text,
        company_name=payload.company_name,
        role=payload.role,
        sponsorship=payload.sponsorship,
        date_posted=payload.date_posted,
        application_link=payload.application_link,
        source=source,
    )
    created = repo.create(job)
    return JobRead.model_validate(created)


@router.get("", response_model=list[JobRead])
def list_jobs(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[JobRead]:
    items = SqlAlchemyJobRepo(db).list_by_user(current_user.id)
    return [JobRead.model_validate(item) for item in items]


@router.patch("/{job_id}", response_model=JobRead)
def update_job(
    job_id: int,
    payload: JobUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JobRead:
    repo = SqlAlchemyJobRepo(db)
    job = repo.get(job_id)
    if not job or job.user_id != current_user.id:
        raise not_found("Job not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(job, key, value)
    return JobRead.model_validate(repo.update(job))


@router.get("/{job_id}", response_model=JobRead)
def get_job(
    job_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JobRead:
    job = SqlAlchemyJobRepo(db).get(job_id)
    if not job or job.user_id != current_user.id:
        raise not_found("Job not found")
    return JobRead.model_validate(job)
