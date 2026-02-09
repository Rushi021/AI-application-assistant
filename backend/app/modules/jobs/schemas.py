from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class JobIngestRequest(BaseModel):
    raw_text: str


class JobRead(BaseModel):
    id: int
    session_id: str
    user_id: Optional[int] = None
    raw_text: str
    created_at: datetime

    class Config:
        from_attributes = True
