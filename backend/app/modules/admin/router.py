from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin_user
from app.modules.admin.schemas import (
    AdminApplicationEventRead,
    AdminApplicationRead,
    AdminUserCreate,
    AdminUserRead,
    AdminUserUpdate,
)
from app.modules.applications.models import Application, ApplicationEvent
from app.modules.users.models import User


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[AdminUserRead])
def list_users(
    search: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    is_admin: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> list[AdminUserRead]:
    query = db.query(User)

    if search:
        value = f"%{search.strip()}%"
        query = query.filter(
            or_(
                User.email.ilike(value),
                User.username.ilike(value),
                User.full_name.ilike(value),
            )
        )
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    if is_admin is not None:
        query = query.filter(User.is_admin == is_admin)

    rows = query.order_by(User.id.desc()).offset(offset).limit(limit).all()
    return [AdminUserRead.model_validate(row) for row in rows]


@router.post("/users", response_model=AdminUserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreate,
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> AdminUserRead:
    email = payload.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User with this email already exists")

    user = User(
        username=email,
        email=email,
        full_name=payload.full_name,
        is_active=payload.is_active,
        is_admin=payload.is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return AdminUserRead.model_validate(user)


@router.patch("/users/{user_id}", response_model=AdminUserRead)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin_user: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> AdminUserRead:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.is_admin is not None:
        if user.id == admin_user.id and payload.is_admin is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove your own admin access",
            )
        user.is_admin = payload.is_admin

    db.commit()
    db.refresh(user)
    return AdminUserRead.model_validate(user)


@router.get("/applications", response_model=list[AdminApplicationRead])
def list_applications(
    status_filter: str | None = Query(default=None, alias="status"),
    user_email: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> list[AdminApplicationRead]:
    query = db.query(Application, User).outerjoin(User, Application.user_id == User.id)

    if status_filter:
        query = query.filter(Application.status == status_filter)
    if user_email:
        query = query.filter(User.email.ilike(f"%{user_email.strip()}%"))

    rows = query.order_by(Application.created_at.desc()).offset(offset).limit(limit).all()
    items: list[AdminApplicationRead] = []
    for app, user in rows:
        items.append(
            AdminApplicationRead(
                id=app.id,
                user_id=app.user_id,
                user_email=user.email if user else None,
                user_full_name=user.full_name if user else None,
                status=app.status,
                company_name=app.company_name,
                role_title=app.role_title,
                portal_url=app.portal_url,
                job_board=app.job_board,
                created_at=app.created_at,
            )
        )
    return items


@router.get("/applications/{application_id}/events", response_model=list[AdminApplicationEventRead])
def list_application_events(
    application_id: int,
    _: User = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> list[AdminApplicationEventRead]:
    exists = db.query(Application.id).filter(Application.id == application_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    rows = (
        db.query(ApplicationEvent)
        .filter(ApplicationEvent.application_id == application_id)
        .order_by(ApplicationEvent.created_at.asc())
        .all()
    )
    return [AdminApplicationEventRead.model_validate(row) for row in rows]
