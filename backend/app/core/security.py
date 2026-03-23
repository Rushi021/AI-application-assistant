"""Security primitives: JWT auth, RequestScope (session-based isolation), and legacy test auth."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, status

from app.core.config import get_settings


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_access_token(user_id: int, email: str) -> str:
    """Create a short-lived JWT access token."""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: int) -> str:
    """Create a long-lived JWT refresh token."""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_refresh_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_jwt_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises HTTPException on failure."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


# ---------------------------------------------------------------------------
# Request scope (session-based isolation)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RequestScope:
    """
    Ownership context attached to every API request.

    v1 (anonymous): session_id is required, user_id is None.
    v2 (auth):      session_id still sent; user_id resolved from auth token.
    """

    session_id: str
    user_id: Optional[int] = None


def validate_session_id(value: str | None) -> str:
    """Validate that session_id is a non-empty UUID string. Returns normalised lowercase."""
    if not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Session-Id header is required",
        )
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Session-Id must be a valid UUID",
        )
    return str(parsed)


# ---------------------------------------------------------------------------
# Legacy test-auth helpers (kept for backward compat; will be removed)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TestUser:
    id: int
    username: str


def verify_test_credentials(username: str, password: str) -> bool:
    settings = get_settings()
    return username == settings.test_username and password == settings.test_password


def issue_test_token() -> str:
    settings = get_settings()
    return settings.test_token


def require_test_token(token: str) -> None:
    settings = get_settings()
    if token != settings.test_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
