"""FastAPI dependencies: DB session, request scope, auth, storage, LLM provider."""

from __future__ import annotations

import json
from typing import Generator, Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.common.adapters.local_storage import LocalResumeStorage
from app.common.adapters.s3_storage import S3ResumeStorage
from app.common.ports import LLMProvider, ResumeStorage
from app.modules.ai.providers.gemini_provider import GeminiProvider
from app.core.config import get_settings
from app.core.security import (
    RequestScope,
    decode_jwt_token,
    require_test_token,
    TestUser,
    validate_session_id,
)
from app.db.session import SessionLocal
from app.modules.users.models import User


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Request scope (v1: anonymous session; v2: adds user_id from JWT)
# ---------------------------------------------------------------------------

def get_request_scope(
    x_session_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> RequestScope:
    """
    Extract and validate session_id from the X-Session-Id header.
    If a JWT Authorization header is also present, resolves user_id.
    """
    session_id = validate_session_id(x_session_id)
    user_id: Optional[int] = None

    # Try to extract user_id from JWT if provided
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        settings = get_settings()
        # Skip JWT decode for legacy test token
        if token == settings.test_token:
            pass
        else:
            try:
                payload = decode_jwt_token(token)
                user_id = int(payload["sub"])
            except Exception:
                pass  # Session still works without user_id

    return RequestScope(session_id=session_id, user_id=user_id)


# ---------------------------------------------------------------------------
# Auth: get current user (supports both JWT and legacy test token)
# ---------------------------------------------------------------------------

def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | TestUser:
    """
    Authenticate via Bearer token. Tries JWT first, falls back to legacy test token.
    Returns the User ORM model (JWT) or TestUser dataclass (legacy).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    token = authorization.split(" ", 1)[1].strip()
    settings = get_settings()

    # Try legacy test token first
    if token == settings.test_token:
        from app.modules.auth.service import get_or_create_test_user
        return get_or_create_test_user(db)

    # JWT auth
    payload = decode_jwt_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token")

    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive account")
    return user


def get_current_user_model(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """
    Like get_current_user but always returns a User ORM model.
    Required for profile endpoints that need to write to the User.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    token = authorization.split(" ", 1)[1].strip()
    settings = get_settings()

    # Legacy test token: look up the test user as a User model
    if token == settings.test_token:
        user = db.query(User).filter(User.username == settings.test_username).first()
        if not user:
            user = User(username=settings.test_username)
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    # JWT auth
    payload = decode_jwt_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token")

    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive account")
    return user


def require_admin_user(
    current_user: User = Depends(get_current_user_model),
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive account")
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


# ---------------------------------------------------------------------------
# Storage + LLM
# ---------------------------------------------------------------------------

def get_resume_storage() -> ResumeStorage:
    settings = get_settings()
    if settings.storage_backend == "local":
        return LocalResumeStorage()
    if settings.storage_backend == "s3":
        return S3ResumeStorage()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid storage backend")


def get_llm_provider() -> LLMProvider:
    """Return the configured LLM provider (Gemini for now). Swap via config later if needed."""
    return GeminiProvider()


def _get_user_api_key_from_profile(user: User | None) -> str | None:
    if user is None or not user.custom_fields:
        return None
    raw = user.custom_fields
    data: dict[str, object] | None = None
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                data = parsed
        except (json.JSONDecodeError, TypeError):
            data = None
    elif isinstance(raw, dict):
        data = raw
    if not data:
        return None
    for key in ("llm_api_key", "gemini_api_key"):
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _resolve_user_from_authorization(
    authorization: str | None,
    db: Session,
) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    settings = get_settings()

    # Legacy test token support
    if token == settings.test_token:
        user = db.query(User).filter(User.username == settings.test_username).first()
        if not user:
            user = User(username=settings.test_username)
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    try:
        payload = decode_jwt_token(token)
        if payload.get("type") != "access":
            return None
        user_id = int(payload["sub"])
    except Exception:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        return None
    return user


def get_llm_provider_for_request(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> LLMProvider:
    """
    Resolve LLM provider for the request.
    - Prefer per-user API key from profile custom_fields (llm_api_key / gemini_api_key).
    - Fall back to server-level GOOGLE_AI_API_KEY/GEMINI_API_KEY.
    """
    user = _resolve_user_from_authorization(authorization, db)
    user_api_key = _get_user_api_key_from_profile(user)
    return GeminiProvider(api_key=user_api_key)
