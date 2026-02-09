from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ApplicationCreate(BaseModel):
    job_id: Optional[int] = None
    resume_id: Optional[int] = None
    status: str = "applied"
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    portal_url: Optional[str] = None
    job_board: Optional[str] = None


class ApplicationUpdate(BaseModel):
    status: str


class ApplicationRead(BaseModel):
    id: int
    session_id: str
    user_id: Optional[int] = None
    job_id: Optional[int] = None
    resume_id: Optional[int] = None
    status: str
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    portal_url: Optional[str] = None
    job_board: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ApplicationEventCreate(BaseModel):
    event_type: str
    detail: Optional[str] = None


class ApplicationEventRead(BaseModel):
    id: int
    application_id: int
    session_id: str
    event_type: str
    detail: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
