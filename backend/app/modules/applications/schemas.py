from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ApplicationCreate(BaseModel):
    job_id: int
    resume_id: int
    tailor_run_id: Optional[int] = None
    status: str = "draft"
    autofill_payload: Optional[str] = None


class ApplicationUpdate(BaseModel):
    status: Optional[str] = None
    autofill_payload: Optional[str] = None


class ApplicationOutcome(BaseModel):
    succeeded: bool
    status: Optional[str] = None


class ApplicationRead(BaseModel):
    id: int
    user_id: int
    job_id: int
    resume_id: int
    tailor_run_id: Optional[int] = None
    status: str
    outcome: Optional[str] = None
    autofill_payload: Optional[str] = None
    applied_at: Optional[datetime] = None
    status_updated_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True
