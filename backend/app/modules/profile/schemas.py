from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ProfileUpsert(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    website_url: Optional[str] = None
    work_authorization: Optional[str] = None
    needs_sponsorship: Optional[bool] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None
    custom_fields_json: Optional[str] = None
    preferred_resume_id: Optional[int] = None


class ProfileRead(ProfileUpsert):
    id: int
    user_id: int
    updated_at: datetime

    class Config:
        from_attributes = True
