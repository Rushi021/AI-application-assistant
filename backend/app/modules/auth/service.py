from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyUserRepo
from app.core.config import get_settings
from app.core.security import TestUser
from app.modules.auth.models import WebLoginCode
from app.modules.auth.google_oauth import GoogleUser
from app.modules.users.models import User


def get_or_create_test_user(db: Session) -> TestUser:
    """Legacy test auth: create or retrieve the hardcoded test user."""
    settings = get_settings()
    repo = SqlAlchemyUserRepo(db)
    user = repo.get_by_username(settings.test_username)
    if not user:
        user = repo.create(settings.test_username)
    return TestUser(id=user.id, username=user.username)


def get_or_create_google_user(db: Session, google_user: GoogleUser) -> tuple[User, bool]:
    """
    Find an existing user by google_id, or create a new one.
    Returns (user, is_new_user).
    """
    # First check by google_id
    user = db.query(User).filter(User.google_id == google_user.google_id).first()
    if user:
        # Update picture if changed
        if google_user.picture and user.picture_url != google_user.picture:
            user.picture_url = google_user.picture
            db.commit()
            db.refresh(user)
        return user, False

    # Check by email (in case user was created via another method)
    user = db.query(User).filter(User.email == google_user.email).first()
    if user:
        # Link google_id to existing user
        user.google_id = google_user.google_id
        user.picture_url = google_user.picture
        if not user.full_name:
            user.full_name = google_user.name
        db.commit()
        db.refresh(user)
        return user, False

    # Create new user
    user = User(
        username=google_user.email,
        google_id=google_user.google_id,
        email=google_user.email,
        full_name=google_user.name,
        picture_url=google_user.picture,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, True


def get_active_whitelisted_google_user(db: Session, google_user: GoogleUser) -> Optional[User]:
    """
    Return an existing active user matching Google identity/email.
    Never auto-creates users: whitelist membership is DB-managed.
    """
    settings = get_settings()
    email = (google_user.email or "").strip().lower()

    # First preference: existing linked Google account.
    user = db.query(User).filter(User.google_id == google_user.google_id).first()
    if not user and email:
        user = db.query(User).filter(User.email == email).first()

    if not user or not user.is_active:
        return None

    if email and user.email != email:
        user.email = email

    user.google_id = google_user.google_id
    user.picture_url = google_user.picture
    if not user.full_name and google_user.name:
        user.full_name = google_user.name

    # Bootstrap admin access through configured allow-list.
    if email and email in settings.admin_emails_list and not user.is_admin:
        user.is_admin = True

    db.commit()
    db.refresh(user)
    return user


def create_web_login_code(db: Session, user_id: int) -> str:
    settings = get_settings()
    raw_code = secrets.token_urlsafe(32)
    code_hash = hashlib.sha256(raw_code.encode("utf-8")).hexdigest()
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        seconds=settings.web_login_code_ttl_seconds
    )

    login_code = WebLoginCode(
        code_hash=code_hash,
        user_id=user_id,
        expires_at=expires_at,
    )
    db.add(login_code)
    db.commit()
    return raw_code


def consume_web_login_code(db: Session, raw_code: str) -> Optional[User]:
    code_hash = hashlib.sha256(raw_code.encode("utf-8")).hexdigest()
    record = db.query(WebLoginCode).filter(WebLoginCode.code_hash == code_hash).first()
    if not record:
        return None
    if record.consumed_at is not None:
        return None
    if record.expires_at <= datetime.now(timezone.utc).replace(tzinfo=None):
        return None

    user = db.query(User).filter(User.id == record.user_id).first()
    if not user or not user.is_active:
        return None

    record.consumed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return user


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Get a user by their primary key."""
    return db.query(User).filter(User.id == user_id).first()
