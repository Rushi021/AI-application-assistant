from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

ALLOWED_STATUSES = (
    "applied",
    "assessment",
    "interview_round_1",
    "interview_round_2",
    "interview_round_3",
    "offer",
    "rejected",
    "withdrawn",
)

ApplicationStatus = Literal[
    "applied",
    "assessment",
    "interview_round_1",
    "interview_round_2",
    "interview_round_3",
    "offer",
    "rejected",
    "withdrawn",
]


class ApplicationCreate(BaseModel):
    job_id: Optional[int] = None
    resume_id: Optional[int] = None
    status: ApplicationStatus = "applied"
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    portal_url: Optional[str] = None
    job_board: Optional[str] = None
    job_description: Optional[str] = None
    salary: Optional[str] = None
    resume_filename: Optional[str] = None
    resume_source: Optional[str] = None
    cover_letter: Optional[str] = None


class ApplicationUpdate(BaseModel):
    status: ApplicationStatus


# Kept as plain str intentionally: legacy rows may contain status values outside the
# current enum (e.g. from older extension versions).  Restricting reads would break
# serialisation of those rows.  Write-side validation via ApplicationStatus is sufficient.
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
    job_description: Optional[str] = None
    salary: Optional[str] = None
    resume_filename: Optional[str] = None
    resume_source: Optional[str] = None
    cover_letter: Optional[str] = None
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
