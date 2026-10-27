from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.common.ports import ScrapedJob


class SearchTargetCreate(BaseModel):
    role: str
    location: str = ""
    keywords: str = ""
    is_active: bool = True


class SearchTargetRead(BaseModel):
    id: int
    user_id: int
    role: str
    location: str
    keywords: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ScrapeSearchRequest(BaseModel):
    roles: list[str]
    locations: list[str]
    keywords: list[str] = Field(default_factory=list)
    persist: bool = True

    @field_validator("roles", "locations")
    @classmethod
    def require_values(cls, values: list[str]) -> list[str]:
        cleaned = [item.strip() for item in values if item and item.strip()]
        if not cleaned:
            raise ValueError("at least one value is required")
        return cleaned

    @field_validator("keywords")
    @classmethod
    def strip_keywords(cls, values: list[str]) -> list[str]:
        return [item.strip() for item in values if item and item.strip()]


class ScrapedJobRead(BaseModel):
    raw_text: str
    company_name: Optional[str] = None
    role: Optional[str] = None
    sponsorship: Optional[str] = None
    date_posted: Optional[str] = None
    application_link: Optional[str] = None
    job_id: Optional[int] = None


class ScrapeSearchResponse(BaseModel):
    provider: str
    results: list[ScrapedJobRead]
    note: str = (
        "Public job feeds; configure an Agent plan for scheduled ATS discovery and preparation."
    )
