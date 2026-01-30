from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.core.security import issue_test_token, verify_test_credentials
from app.modules.auth.schemas import LoginRequest, TokenResponse
from app.modules.auth.service import get_or_create_test_user
from app.modules.users.schemas import UserRead


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if not verify_test_credentials(payload.username, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    get_or_create_test_user(db)
    return TokenResponse(access_token=issue_test_token())


@router.get("/me", response_model=UserRead)
def me(current_user=Depends(get_current_user)) -> UserRead:
    return UserRead(id=current_user.id, username=current_user.username)
