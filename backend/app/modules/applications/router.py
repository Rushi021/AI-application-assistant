from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyApplicationRepo
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db
from app.modules.applications.models import Application
from app.modules.applications.schemas import ApplicationCreate, ApplicationRead, ApplicationUpdate


router = APIRouter(prefix="/applications", tags=["applications"])


@router.post("", response_model=ApplicationRead)
def create_application(
    payload: ApplicationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    application = Application(
        user_id=current_user.id,
        job_id=payload.job_id,
        resume_id=payload.resume_id,
        status=payload.status,
    )
    created = repo.create(application)
    return ApplicationRead.model_validate(created)


@router.patch("/{application_id}", response_model=ApplicationRead)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    updated = repo.update_status(application_id, payload.status)
    if not updated or updated.user_id != current_user.id:
        raise not_found("Application not found")
    return ApplicationRead.model_validate(updated)


@router.get("", response_model=list[ApplicationRead])
def list_applications(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ApplicationRead]:
    repo = SqlAlchemyApplicationRepo(db)
    items = repo.list_by_user(current_user.id)
    return [ApplicationRead.model_validate(item) for item in items]
