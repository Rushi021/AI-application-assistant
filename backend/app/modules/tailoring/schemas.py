from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class TailorCreate(BaseModel):
    job_id: int
    resume_id: int
    do_tailor: bool = True
    personalized_instructions: str = ""


class SectionPatch(BaseModel):
    name: Optional[str] = None
    body_text: Optional[str] = None
    latex_source: Optional[str] = None
    bullets: Optional[list[dict[str, Any]]] = None


class RewriteRequest(BaseModel):
    bullet_index: Optional[int] = None
    instructions: str = ""


class TailorRunRead(BaseModel):
    id: int
    user_id: int
    job_id: int
    resume_id: int
    status: str
    do_tailor: bool
    personalized_instructions: Optional[str] = None
    sections_json: str
    cover_letter: Optional[str] = None
    final_latex: Optional[str] = None
    final_pdf_key: Optional[str] = None
    compiler_warning: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
