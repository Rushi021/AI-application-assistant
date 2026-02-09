"""User profile CRUD endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user_model, get_db
from app.modules.users.models import User
from app.modules.users.schemas import UserProfileRead, UserProfileUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/profile", response_model=UserProfileRead)
def get_my_profile(
    current_user: User = Depends(get_current_user_model),
) -> UserProfileRead:
    """Get the full profile of the currently authenticated user."""
    return UserProfileRead.model_validate(current_user)


@router.put("/me/profile", response_model=UserProfileRead)
def update_my_profile(
    payload: UserProfileUpdate,
    current_user: User = Depends(get_current_user_model),
    db: Session = Depends(get_db),
) -> UserProfileRead:
    """Full update of the user profile (replaces all updatable fields)."""
    _apply_profile_update(current_user, payload, partial=False)
    db.commit()
    db.refresh(current_user)
    return UserProfileRead.model_validate(current_user)


@router.patch("/me/profile", response_model=UserProfileRead)
def patch_my_profile(
    payload: UserProfileUpdate,
    current_user: User = Depends(get_current_user_model),
    db: Session = Depends(get_db),
) -> UserProfileRead:
    """Partial update — only supplied (non-None) fields are changed."""
    _apply_profile_update(current_user, payload, partial=True)
    db.commit()
    db.refresh(current_user)
    return UserProfileRead.model_validate(current_user)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UPDATABLE_FIELDS = [
    "full_name", "phone", "address_line1", "address_line2", "city", "state",
    "zip_code", "country", "linkedin_url", "portfolio_url", "github_url",
    "years_of_experience", "current_title", "current_company", "degree",
    "field_of_study", "university", "graduation_year", "gpa", "visa_status",
    "work_authorization", "sponsorship_needed", "gender", "ethnicity",
    "veteran_status", "disability_status", "expected_salary", "current_salary",
    "salary_currency",
]


def _apply_profile_update(user: User, payload: UserProfileUpdate, *, partial: bool) -> None:
    data = payload.model_dump(exclude_unset=partial)

    for field in _UPDATABLE_FIELDS:
        if field in data:
            setattr(user, field, data[field])

    # Handle custom_fields (stored as JSON text)
    if "custom_fields" in data:
        cf = data["custom_fields"]
        user.custom_fields = json.dumps(cf) if cf is not None else None
