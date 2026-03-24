from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class DraftCreate(BaseModel):
    """Create a draft from a base or tailored resume."""
    base_resume_id: int
    run_id: Optional[int] = None
    starting_source: str = "base"  # 'base' or 'tailored'
    job_description: Optional[str] = None


class SectionRead(BaseModel):
    id: int
    section_id: str
    section_title: str
    order_index: int
    original_text: str
    current_text: str
    proposed_text: Optional[str] = None
    last_feedback: Optional[str] = None
    editable: bool = True
    section_group: Optional[str] = None
    para_start: Optional[int] = None
    para_end: Optional[int] = None

    class Config:
        from_attributes = True


class DraftRead(BaseModel):
    id: int
    session_id: str
    run_id: Optional[int] = None
    base_resume_id: int
    starting_source: str
    status: str
    job_description: Optional[str] = None
    cover_letter: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    sections: List[SectionRead] = []

    class Config:
        from_attributes = True


class SectionChatRequest(BaseModel):
    """User sends a message to refine a section."""
    message: str
    user_feedback: Optional[str] = None  # 'liked' / 'disliked' / null
    include_history: bool = True


class SectionChatResponse(BaseModel):
    proposed_text: str
    assistant_message: str


class SectionPatchRequest(BaseModel):
    """Manual inline edit of a section."""
    current_text: str


class ChatMessageRead(BaseModel):
    id: int
    section_id: str
    role: str
    content: str
    turn_index: int
    created_at: datetime

    class Config:
        from_attributes = True


class GenerateCoverLetterRequest(BaseModel):
    """Optional instructions for cover letter generation."""
    cover_letter_instructions: Optional[str] = None


class GenerateCoverLetterResponse(BaseModel):
    cover_letter: str


class CoverLetterDocxRequest(BaseModel):
    """Render a .docx from cover letter body text (no LLM)."""

    cover_letter: str
