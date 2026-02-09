from datetime import datetime
from typing import Optional

from pydantic import BaseModel, model_validator


class PipelineRunCreate(BaseModel):
    """Job description + resume: provide resume_text, or resume_id (uploaded Word doc), or both."""

    job_description: str
    resume_text: Optional[str] = None
    resume_id: Optional[int] = None
    tailor_instructions: Optional[str] = None
    cover_letter_instructions: Optional[str] = None

    @model_validator(mode="after")
    def require_resume(self):
        if not self.resume_text and self.resume_id is None:
            raise ValueError("Provide either resume_text or resume_id")
        return self


class PipelineRunRead(BaseModel):
    id: int
    session_id: str
    user_id: Optional[int] = None
    status: str
    created_at: datetime
    job_description: Optional[str] = None
    resume_text: Optional[str] = None
    resume_id: Optional[int] = None
    tailored_resume: Optional[str] = None
    tailored_sections: Optional[str] = None
    cover_letter: Optional[str] = None

    class Config:
        from_attributes = True
