from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AdminUserRead(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    is_active: bool
    is_admin: bool

    class Config:
        from_attributes = True


class AdminUserCreate(BaseModel):
    email: str
    is_active: bool = True
    is_admin: bool = False
    full_name: Optional[str] = None


class AdminUserUpdate(BaseModel):
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


class AdminApplicationRead(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    status: str
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    portal_url: Optional[str] = None
    job_board: Optional[str] = None
    created_at: datetime


class AdminApplicationEventRead(BaseModel):
    id: int
    application_id: int
    session_id: str
    event_type: str
    detail: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
