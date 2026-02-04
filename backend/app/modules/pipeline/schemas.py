from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PipelineRunCreate(BaseModel):
    """Job description and resume text; job description can be hardcoded by client."""

    job_description: str
    resume_text: str


class PipelineRunRead(BaseModel):
    id: int
    user_id: int
    status: str
    created_at: datetime
    job_description: Optional[str] = None
    resume_text: Optional[str] = None
    tailored_resume: Optional[str] = None
    cover_letter: Optional[str] = None

    class Config:
        from_attributes = True
