from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.modules.resumes.models import RESUME_FAMILIES


class BulletRead(BaseModel):
    id: int
    order_index: int
    text: str
    latex_source: str

    class Config:
        from_attributes = True


class SectionRead(BaseModel):
    id: int
    name: str
    order_index: int
    body_text: str
    latex_source: str
    bullets: list[BulletRead] = []

    class Config:
        from_attributes = True


class ResumeRead(BaseModel):
    id: int
    user_id: int
    original_filename: str
    file_key: str
    content_type: str
    size_bytes: int
    sha256: str
    family: str
    version: int
    is_active: bool
    source_format: str
    created_at: datetime
    file_path: str
    sections: list[SectionRead] = []

    class Config:
        from_attributes = True


class ResumeUploadMeta(BaseModel):
    family: str = Field(..., description=f"One of {RESUME_FAMILIES}")
    version: int = Field(default=1, ge=1, le=2)
