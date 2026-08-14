import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyProfileRepo
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db
from app.modules.profile.models import Profile
from app.modules.profile.schemas import ProfileRead, ProfileUpsert, SALARY_RANGE_SPREAD

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=ProfileRead)
def get_profile(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileRead:
    profile = SqlAlchemyProfileRepo(db).get_by_user(current_user.id)
    if not profile:
        raise not_found("Profile not found")
    return ProfileRead.model_validate(profile)


@router.put("", response_model=ProfileRead)
def upsert_profile(
    payload: ProfileUpsert,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileRead:
    data = payload.model_dump()
    education = data.pop("education", None)
    if education is not None:
        data["education_json"] = json.dumps(education)
    parts = [data.get("first_name") or "", data.get("middle_name") or "", data.get("last_name") or ""]
    joined = " ".join(part.strip() for part in parts if part and part.strip())
    if joined or any(data.get(key) is not None for key in ("first_name", "middle_name", "last_name")):
        data["full_name"] = joined or None
    base = data.get("desired_salary_base")
    if base is not None:
        data["desired_salary_min"] = data.get("desired_salary_min") if data.get("desired_salary_min") is not None else base
        data["desired_salary_max"] = (
            data.get("desired_salary_max") if data.get("desired_salary_max") is not None else base + SALARY_RANGE_SPREAD
        )
    profile = Profile(user_id=current_user.id, **data)
    saved = SqlAlchemyProfileRepo(db).upsert(profile)
    return ProfileRead.model_validate(saved)
