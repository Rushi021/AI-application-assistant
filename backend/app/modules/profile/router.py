from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyProfileRepo
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db
from app.modules.profile.models import Profile
from app.modules.profile.schemas import ProfileRead, ProfileUpsert

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
    profile = Profile(user_id=current_user.id, **payload.model_dump())
    saved = SqlAlchemyProfileRepo(db).upsert(profile)
    return ProfileRead.model_validate(saved)
