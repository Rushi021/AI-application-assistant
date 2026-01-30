from datetime import datetime

from pydantic import BaseModel


class PipelineRunCreate(BaseModel):
    pass


class PipelineRunRead(BaseModel):
    id: int
    user_id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True
