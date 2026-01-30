from dataclasses import dataclass

from fastapi import HTTPException, status

from app.core.config import get_settings


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
