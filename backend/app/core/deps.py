from __future__ import annotations

from typing import Generator

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.common.adapters.local_storage import LocalResumeStorage
from app.common.adapters.s3_storage import S3ResumeStorage
from app.common.ports import ResumeStorage
from app.core.config import get_settings
from app.core.security import require_test_token, TestUser
from app.db import session as db_session
from app.modules.ai.gateway import ModelGateway
from app.modules.ai.ports import UsageLogger
from app.modules.ai.usage import SqlAlchemyUsageLogger
from app.modules.auth.service import get_or_create_test_user


def get_db() -> Generator[Session, None, None]:
    db = db_session.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> TestUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    require_test_token(token)
    return get_or_create_test_user(db)


def get_resume_storage() -> ResumeStorage:
    settings = get_settings()
    if settings.storage_backend == "local":
        return LocalResumeStorage()
    if settings.storage_backend == "s3":
        return S3ResumeStorage()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid storage backend")


def get_usage_logger() -> UsageLogger:
    return SqlAlchemyUsageLogger()


def get_model_gateway(usage: UsageLogger = Depends(get_usage_logger)) -> ModelGateway:
    """Request-scoped gateway. Callers pass a *task* name, never a provider."""
    return ModelGateway(usage=usage)
