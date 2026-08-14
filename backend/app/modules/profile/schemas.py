from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

SALARY_RANGE_SPREAD = 10_000


class EducationEntry(BaseModel):
    degree: Optional[str] = None
    school_name: Optional[str] = None
    field_of_study: Optional[str] = None
    graduation_date: Optional[str] = None
    gpa: Optional[str] = None


class ProfileUpsert(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    website_url: Optional[str] = None
    work_authorization: Optional[str] = None
    needs_sponsorship: Optional[bool] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None
    custom_fields_json: Optional[str] = None
    preferred_resume_id: Optional[int] = None

    desired_salary_base: Optional[int] = Field(default=None, ge=0)
    desired_salary_min: Optional[int] = Field(default=None, ge=0)
    desired_salary_max: Optional[int] = Field(default=None, ge=0)
    gender: Optional[str] = None
    race_ethnicity: Optional[str] = None
    veteran_status: Optional[str] = None
    disability_status: Optional[str] = None
    willing_to_relocate: Optional[bool] = None

    highest_degree: Optional[str] = None
    school_name: Optional[str] = None
    field_of_study: Optional[str] = None
    graduation_date: Optional[str] = None
    gpa: Optional[str] = None
    education: Optional[list[EducationEntry]] = None

    legally_authorized_to_work: Optional[bool] = None
    work_auth_country: Optional[str] = None
    citizenship_country: Optional[str] = None
    at_least_18: Optional[bool] = None
    has_non_compete: Optional[bool] = None


class ProfileRead(ProfileUpsert):
    id: int
    user_id: int
    updated_at: datetime

    class Config:
        from_attributes = True
