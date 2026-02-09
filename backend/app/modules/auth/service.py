from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyUserRepo
from app.core.config import get_settings
from app.core.security import TestUser
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


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Get a user by their primary key."""
    return db.query(User).filter(User.id == user_id).first()
