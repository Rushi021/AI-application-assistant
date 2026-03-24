from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user_model, get_db
from app.modules.applications.models import Application, ApplicationEvent
from app.modules.applications.schemas import ApplicationEventRead, ApplicationRead, ApplicationUpdate
from app.modules.users.models import User


router = APIRouter(prefix="/me", tags=["me"])


@router.get("/applications", response_model=list[ApplicationRead])
def list_my_applications(
    current_user: User = Depends(get_current_user_model),
    db: Session = Depends(get_db),
) -> list[ApplicationRead]:
    rows = (
        db.query(Application)
        .filter(Application.user_id == current_user.id)
        .order_by(Application.created_at.desc())
        .all()
    )
    return [ApplicationRead.model_validate(row) for row in rows]


@router.patch("/applications/{application_id}/status", response_model=ApplicationRead)
def update_my_application_status(
    application_id: int,
    payload: ApplicationUpdate,
    current_user: User = Depends(get_current_user_model),
    db: Session = Depends(get_db),
) -> ApplicationRead:
    row = db.query(Application).filter(Application.id == application_id, Application.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    row.status = payload.status
    db.commit()
    db.refresh(row)
    return ApplicationRead.model_validate(row)


@router.get("/applications/{application_id}/events", response_model=list[ApplicationEventRead])
def list_my_application_events(
    application_id: int,
    current_user: User = Depends(get_current_user_model),
    db: Session = Depends(get_db),
) -> list[ApplicationEventRead]:
    app = db.query(Application).filter(Application.id == application_id, Application.user_id == current_user.id).first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    rows = (
        db.query(ApplicationEvent)
        .filter(ApplicationEvent.application_id == application_id)
        .order_by(ApplicationEvent.created_at.asc())
        .all()
    )
    return [ApplicationEventRead.model_validate(row) for row in rows]
