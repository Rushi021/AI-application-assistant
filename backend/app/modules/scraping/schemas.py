from datetime import datetime
from typing import Optional

from pydantic import BaseModel

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
    role: str
    location: str = ""
    keywords: str = ""
    persist: bool = True


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
        "Placeholder scraper. Swap NoopJobBoardScraper for a real JobBoardScraper adapter."
    )
