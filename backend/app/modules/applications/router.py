from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyApplicationRepo, SqlAlchemyApplicationEventRepo
from app.common.errors import not_found
from app.core.deps import get_db, get_request_scope
from app.core.security import RequestScope
from app.modules.applications.models import Application, ApplicationEvent
from app.modules.applications.schemas import (
    ApplicationCreate,
    ApplicationEventCreate,
    ApplicationEventRead,
    ApplicationRead,
    ApplicationUpdate,
)


router = APIRouter(prefix="/applications", tags=["applications"])


@router.post("", response_model=ApplicationRead)
def create_application(
    payload: ApplicationCreate,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    application = Application(
        session_id=scope.session_id,
        user_id=scope.user_id,
        job_id=payload.job_id,
        resume_id=payload.resume_id,
        status=payload.status,
        company_name=payload.company_name,
        role_title=payload.role_title,
        portal_url=payload.portal_url,
        job_board=payload.job_board,
    )
    created = repo.create(application)
    return ApplicationRead.model_validate(created)


@router.patch("/{application_id}", response_model=ApplicationRead)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    updated = repo.update_status(scope.session_id, application_id, payload.status)
    if not updated:
        raise not_found("Application not found")
    return ApplicationRead.model_validate(updated)


@router.get("", response_model=list[ApplicationRead])
def list_applications(
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> list[ApplicationRead]:
    repo = SqlAlchemyApplicationRepo(db)
    items = repo.list_by_session(scope.session_id)
    return [ApplicationRead.model_validate(item) for item in items]


@router.get("/{application_id}", response_model=ApplicationRead)
def get_application(
    application_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    repo = SqlAlchemyApplicationRepo(db)
    item = repo.get_by_scope(scope.session_id, application_id)
    if not item:
        raise not_found("Application not found")
    return ApplicationRead.model_validate(item)


@router.post("/{application_id}/events", response_model=ApplicationEventRead)
def create_event(
    application_id: int,
    payload: ApplicationEventCreate,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> ApplicationEventRead:
    # Verify application belongs to this session
    app_repo = SqlAlchemyApplicationRepo(db)
    app = app_repo.get_by_scope(scope.session_id, application_id)
    if not app:
        raise not_found("Application not found")
    event_repo = SqlAlchemyApplicationEventRepo(db)
    event = ApplicationEvent(
        application_id=application_id,
        session_id=scope.session_id,
        event_type=payload.event_type,
        detail=payload.detail,
    )
    created = event_repo.create(event)
    return ApplicationEventRead.model_validate(created)


@router.get("/{application_id}/events", response_model=list[ApplicationEventRead])
def list_events(
    application_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> list[ApplicationEventRead]:
    event_repo = SqlAlchemyApplicationEventRepo(db)
    items = event_repo.list_by_application(scope.session_id, application_id)
    return [ApplicationEventRead.model_validate(item) for item in items]
