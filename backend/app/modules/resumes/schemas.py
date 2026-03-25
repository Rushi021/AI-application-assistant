from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ResumeRead(BaseModel):
    id: int
    session_id: str
    user_id: Optional[int] = None
    original_filename: str
    file_key: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime
    file_path: str
    client_stored: bool = Field(
        default=False,
        description="Blob kept on user device only (server uses parsed JSON; file_key prefix local:).",
    )

    class Config:
        from_attributes = True
