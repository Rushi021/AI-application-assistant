from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user, get_current_user_model
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
    WebBridgeResponse,
    WebExchangeRequest,
)
from app.modules.auth.service import (
    consume_web_login_code,
    create_web_login_code,
    get_active_whitelisted_google_user,
    get_or_create_test_user,
)
from app.modules.users.models import User
from app.modules.users.schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _build_web_state(next_url: str | None) -> str:
    settings = get_settings()
    payload = {
        "next": next_url or settings.web_app_url,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def _parse_web_state(state: str) -> str:
    settings = get_settings()
    try:
        payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc

    next_url = str(payload.get("next") or settings.web_app_url)
    if not next_url.startswith(settings.web_app_url):
        return settings.web_app_url
    return next_url


def _append_query_param(url: str, key: str, value: str) -> str:
    parsed = urlparse(url)
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    query_pairs.append((key, value))
    new_query = urlencode(query_pairs)
    return urlunparse(parsed._replace(query=new_query))


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

    user = get_active_whitelisted_google_user(db, google_user)
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    access_token = create_access_token(user.id, user.email or user.username)
    refresh_token = create_refresh_token(user.id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        is_new_user=False,
    )


@router.get("/web/google/start")
def web_google_start(next_url: str | None = Query(default=None, alias="next")) -> RedirectResponse:
    settings = get_settings()
    if not settings.google_client_id.strip() or not settings.google_client_secret.strip():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google OAuth not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_web_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": _build_web_state(next_url),
    }
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/web/google/callback")
async def web_google_callback(
    code: str,
    state: str,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    settings = get_settings()
    next_url = _parse_web_state(state)

    async with httpx.AsyncClient(timeout=20.0) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_web_redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if token_resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google token exchange failed")

    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google access token missing")

    google_user = await verify_google_access_token(access_token)
    user = get_active_whitelisted_google_user(db, google_user)
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    login_code = create_web_login_code(db, user.id)
    return RedirectResponse(url=_append_query_param(next_url, "code", login_code))


@router.post("/web/bridge", response_model=WebBridgeResponse)
def web_bridge(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_model),
) -> WebBridgeResponse:
    """
    Mint a one-time login code for the authenticated user (e.g. Chrome extension → web app).
    Code TTL is capped at 60 seconds; exchange via POST /auth/web/exchange.
    """
    raw = create_web_login_code(db, current_user.id, ttl_seconds=60)
    return WebBridgeResponse(code=raw)


@router.post("/web/exchange", response_model=TokenResponse)
def web_exchange(payload: WebExchangeRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = consume_web_login_code(db, payload.code)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired login code")

    access_token = create_access_token(user.id, user.email or user.username)
    refresh_token = create_refresh_token(user.id)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        is_new_user=False,
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

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
