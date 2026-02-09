from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_jwt_token,
    issue_test_token,
    verify_test_credentials,
)
from app.modules.auth.google_oauth import verify_google_access_token, verify_google_id_token
from app.core.config import get_settings
from app.modules.auth.schemas import (
    DevLoginRequest,
    GoogleAuthRequest,
    LoginRequest,
    RefreshTokenRequest,
    TokenResponse,
)
from app.modules.auth.service import get_or_create_google_user, get_or_create_test_user
from app.modules.users.models import User
from app.modules.users.schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------

@router.post("/google", response_model=TokenResponse)
async def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Exchange a Google token (ID token or access token) for app JWT tokens.
    Called by the Chrome extension after the user signs in with Google.
    """
    if payload.token_type == "access_token":
        google_user = await verify_google_access_token(payload.token)
    else:
        google_user = await verify_google_id_token(payload.token)

    user, is_new = get_or_create_google_user(db, google_user)

    access_token = create_access_token(user.id, user.email or user.username)
    refresh_token = create_refresh_token(user.id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        is_new_user=is_new,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshTokenRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Exchange a refresh token for a new access token."""
    token_data = decode_jwt_token(payload.refresh_token)
    if token_data.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a refresh token")

    user_id = int(token_data["sub"])
    from app.modules.auth.service import get_user_by_id
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    access_token = create_access_token(user.id, user.email or user.username)
    return TokenResponse(access_token=access_token)


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserRead)
def me(current_user=Depends(get_current_user)) -> UserRead:
    """Get the currently authenticated user. Works with both JWT and legacy test token."""
    return UserRead.model_validate(current_user)


# ---------------------------------------------------------------------------
# Dev login (development only — no Google Cloud setup needed)
# ---------------------------------------------------------------------------

@router.post("/dev-login", response_model=TokenResponse)
def dev_login(payload: DevLoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Quick login for development. Creates/retrieves a user by email and returns
    JWT tokens. Only enabled when ENVIRONMENT=development.
    """
    settings = get_settings()
    if settings.environment != "development":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Dev login disabled in production")

    if not payload.email or not payload.email.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required")

    email = payload.email.strip().lower()
    name = payload.full_name.strip() or email.split("@")[0]

    # Find or create user by email
    user = db.query(User).filter(User.email == email).first()
    is_new = False
    if not user:
        user = User(
            username=email,
            email=email,
            full_name=name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        is_new = True

    access_token = create_access_token(user.id, user.email or user.username)
    refresh_token = create_refresh_token(user.id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        is_new_user=is_new,
    )


# ---------------------------------------------------------------------------
# Legacy test auth (kept for backward compat)
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Legacy test login. Returns a test token for backward compatibility."""
    if not verify_test_credentials(payload.username, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    get_or_create_test_user(db)
    return TokenResponse(access_token=issue_test_token())
