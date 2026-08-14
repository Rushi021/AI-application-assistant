from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class JobIngestRequest(BaseModel):
    raw_text: str
    company_name: Optional[str] = None
    role: Optional[str] = None
    sponsorship: Optional[str] = None
    date_posted: Optional[str] = None
    application_link: Optional[str] = None
    source: str = "manual"


class JobRead(BaseModel):
    id: int
    user_id: int
    raw_text: str
    company_name: Optional[str] = None
    role: Optional[str] = None
    sponsorship: Optional[str] = None
    date_posted: Optional[str] = None
    application_link: Optional[str] = None
    source: str
    recommended_resume_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True
