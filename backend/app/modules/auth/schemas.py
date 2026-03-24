from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Legacy test auth
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    is_new_user: bool = False


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------

class GoogleAuthRequest(BaseModel):
    """Sent by the Chrome extension after Google sign-in."""
    token: str
    token_type: str = "id_token"  # "id_token" or "access_token"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class WebExchangeRequest(BaseModel):
    code: str


# ---------------------------------------------------------------------------
# Dev login (for development without Google OAuth setup)
# ---------------------------------------------------------------------------

class DevLoginRequest(BaseModel):
    """Quick dev login — just provide an email. Only works in development."""
    email: str
    full_name: str = ""
