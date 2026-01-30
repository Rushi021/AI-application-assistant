from datetime import datetime

from pydantic import BaseModel


class ResumeRead(BaseModel):
    id: int
    user_id: int
    original_filename: str
    file_key: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime
    file_path: str

    class Config:
        from_attributes = True
