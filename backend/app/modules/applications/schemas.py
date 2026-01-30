from datetime import datetime

from pydantic import BaseModel


class ApplicationCreate(BaseModel):
    job_id: int
    resume_id: int
    status: str = "applied"


class ApplicationUpdate(BaseModel):
    status: str


class ApplicationRead(BaseModel):
    id: int
    user_id: int
    job_id: int
    resume_id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True
