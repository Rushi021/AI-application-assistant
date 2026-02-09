from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel, field_validator


class UserRead(BaseModel):
    """Public user representation."""
    id: int
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    picture_url: Optional[str] = None

    class Config:
        from_attributes = True


class UserProfileRead(BaseModel):
    """Full user profile (returned from GET /users/me/profile)."""
    id: int
    username: str
    email: Optional[str] = None
    picture_url: Optional[str] = None

    # Basic
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None

    # Professional
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    years_of_experience: Optional[int] = None
    current_title: Optional[str] = None
    current_company: Optional[str] = None

    # Education
    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    university: Optional[str] = None
    graduation_year: Optional[int] = None
    gpa: Optional[float] = None

    # Work authorization
    visa_status: Optional[str] = None
    work_authorization: Optional[str] = None
    sponsorship_needed: Optional[bool] = None

    # Demographics (EEO)
    gender: Optional[str] = None
    ethnicity: Optional[str] = None
    veteran_status: Optional[str] = None
    disability_status: Optional[str] = None

    # Salary
    expected_salary: Optional[str] = None
    current_salary: Optional[str] = None
    salary_currency: Optional[str] = None

    # Custom
    custom_fields: Optional[dict[str, Any]] = None

    @field_validator("custom_fields", mode="before")
    @classmethod
    def parse_custom_fields(cls, v: Any) -> Optional[dict[str, Any]]:
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return None
        return v

    class Config:
        from_attributes = True


class UserProfileUpdate(BaseModel):
    """Fields that can be updated on the user profile. All optional for PATCH."""
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None

    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    years_of_experience: Optional[int] = None
    current_title: Optional[str] = None
    current_company: Optional[str] = None

    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    university: Optional[str] = None
    graduation_year: Optional[int] = None
    gpa: Optional[float] = None

    visa_status: Optional[str] = None
    work_authorization: Optional[str] = None
    sponsorship_needed: Optional[bool] = None

    gender: Optional[str] = None
    ethnicity: Optional[str] = None
    veteran_status: Optional[str] = None
    disability_status: Optional[str] = None

    expected_salary: Optional[str] = None
    current_salary: Optional[str] = None
    salary_currency: Optional[str] = None

    custom_fields: Optional[dict[str, Any]] = None
