from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import (
    SqlAlchemyApplicationRepo,
    SqlAlchemyJobRepo,
    SqlAlchemyProfileRepo,
    SqlAlchemyResumeRepo,
    SqlAlchemyTailorRunRepo,
)
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db
from app.modules.applications.service import upsert_application
from app.modules.applications.schemas import (
    ApplicationCreate,
    ApplicationOutcome,
    ApplicationRead,
    ApplicationUpdate,
)
from app.modules.profile.schemas import ProfileRead

router = APIRouter(prefix="/applications", tags=["applications"])


@router.post("", response_model=ApplicationRead)
def create_application(
    payload: ApplicationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    """Log an application. Logging the same job + resume again updates that row."""
    job = SqlAlchemyJobRepo(db).get(payload.job_id)
    resume = SqlAlchemyResumeRepo(db).get(payload.resume_id)
    run = SqlAlchemyTailorRunRepo(db).get(payload.tailor_run_id) if payload.tailor_run_id else None
    created = upsert_application(
        db,
        user_id=current_user.id,
        job=job,
        resume=resume,
        job_id=payload.job_id,
        resume_id=payload.resume_id,
        status=payload.status,
        tailor_run_id=payload.tailor_run_id,
        resume_tailored=run.do_tailor if run else None,
        document_path=(run.exported_docx_path or run.exported_tex_path) if run else None,
        autofill_payload=payload.autofill_payload,
    )
    return ApplicationRead.model_validate(created)


@router.patch("/{application_id}", response_model=ApplicationRead)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    application = repo.get(application_id)
    if not application or application.user_id != current_user.id:
        raise not_found("Application not found")
    if payload.status is not None:
        application.status = payload.status
        application.status_updated_at = datetime.utcnow()
        if payload.status == "applied" and application.applied_at is None:
            application.applied_at = datetime.utcnow()
    if payload.autofill_payload is not None:
        application.autofill_payload = payload.autofill_payload
    return ApplicationRead.model_validate(repo.update(application))


@router.post("/{application_id}/outcome", response_model=ApplicationRead)
def record_outcome(
    application_id: int,
    payload: ApplicationOutcome,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    application = repo.get(application_id)
    if not application or application.user_id != current_user.id:
        raise not_found("Application not found")
    application.outcome = "succeeded" if payload.succeeded else "failed"
    application.status = payload.status or ("applied" if payload.succeeded else "failed")
    application.status_updated_at = datetime.utcnow()
    if payload.succeeded and application.applied_at is None:
        application.applied_at = datetime.utcnow()
    return ApplicationRead.model_validate(repo.update(application))


@router.get("", response_model=list[ApplicationRead])
def list_applications(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ApplicationRead]:
    items = SqlAlchemyApplicationRepo(db).list_by_user(current_user.id)
    return [ApplicationRead.model_validate(item) for item in items]


@router.get("/autofill-payload")
def autofill_payload(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    profile = SqlAlchemyProfileRepo(db).get_by_user(current_user.id)
    if not profile:
        return {}
    return ProfileRead.model_validate(profile).model_dump()
