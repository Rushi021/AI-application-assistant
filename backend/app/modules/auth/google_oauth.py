"""Google OAuth token verification."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


@dataclass
class GoogleUser:
    """Extracted Google user info."""
    google_id: str
    email: str
    name: str
    picture: Optional[str] = None


async def verify_google_id_token(id_token: str) -> GoogleUser:
    """
    Verify a Google ID token and return the user information.

    Uses Google's tokeninfo endpoint to validate the token, then
    checks that the audience matches our client ID.
    """
    settings = get_settings()

    async with httpx.AsyncClient() as client:
        resp = await client.get(GOOGLE_TOKENINFO_URL, params={"id_token": id_token})

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google ID token",
        )

    payload = resp.json()

    # Validate audience matches our client ID (skip if not configured for dev)
    if settings.google_client_id:
        aud = payload.get("aud", "")
        if aud != settings.google_client_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token audience mismatch",
            )

    google_id = payload.get("sub")
    email = payload.get("email")

    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing required fields (sub, email)",
        )

    return GoogleUser(
        google_id=google_id,
        email=email,
        name=payload.get("name", email.split("@")[0]),
        picture=payload.get("picture"),
    )


async def verify_google_access_token(access_token: str) -> GoogleUser:
    """
    Verify a Google access token by calling the userinfo endpoint.

    Used when the Chrome extension sends an access token from
    chrome.identity.getAuthToken() instead of an ID token.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google access token",
        )

    payload = resp.json()

    google_id = payload.get("sub")
    email = payload.get("email")

    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not retrieve Google user info",
        )

    return GoogleUser(
        google_id=google_id,
        email=email,
        name=payload.get("name", email.split("@")[0]),
        picture=payload.get("picture"),
    )
