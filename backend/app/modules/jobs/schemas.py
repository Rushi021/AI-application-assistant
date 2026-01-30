from datetime import datetime

from pydantic import BaseModel


class JobIngestRequest(BaseModel):
    raw_text: str


class JobRead(BaseModel):
    id: int
    user_id: int
    raw_text: str
    created_at: datetime

    class Config:
        from_attributes = True
