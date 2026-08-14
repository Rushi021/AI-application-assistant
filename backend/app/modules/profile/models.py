import json
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# SQLite ALTER types for columns added after the first create_all.
PROFILE_SQLITE_COLUMNS: dict[str, str] = {
    "preferred_resume_id": "INTEGER",
    "first_name": "VARCHAR(100)",
    "middle_name": "VARCHAR(100)",
    "last_name": "VARCHAR(100)",
    "desired_salary_base": "INTEGER",
    "desired_salary_min": "INTEGER",
    "desired_salary_max": "INTEGER",
    "gender": "VARCHAR(80)",
    "race_ethnicity": "VARCHAR(120)",
    "veteran_status": "VARCHAR(80)",
    "disability_status": "VARCHAR(80)",
    "willing_to_relocate": "BOOLEAN",
    "highest_degree": "VARCHAR(120)",
    "school_name": "VARCHAR(255)",
    "field_of_study": "VARCHAR(255)",
    "graduation_date": "VARCHAR(20)",
    "gpa": "VARCHAR(20)",
    "education_json": "TEXT",
    "legally_authorized_to_work": "BOOLEAN",
    "work_auth_country": "VARCHAR(100)",
    "citizenship_country": "VARCHAR(100)",
    "at_least_18": "BOOLEAN",
    "has_non_compete": "BOOLEAN",
}

PROFILE_UPSERT_FIELDS = (
    "full_name",
    "email",
    "phone",
    "location",
    "linkedin_url",
    "github_url",
    "website_url",
    "work_authorization",
    "needs_sponsorship",
    "address_line1",
    "city",
    "state",
    "zip_code",
    "country",
    "custom_fields_json",
    "preferred_resume_id",
    *PROFILE_SQLITE_COLUMNS.keys(),
)


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), unique=True, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    first_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    middle_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    last_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    linkedin_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    github_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    website_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    work_authorization: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    needs_sponsorship: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    zip_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    custom_fields_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    preferred_resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    desired_salary_base: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    desired_salary_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    desired_salary_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    race_ethnicity: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    veteran_status: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    disability_status: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    willing_to_relocate: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    highest_degree: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    school_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    field_of_study: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    graduation_date: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    gpa: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    education_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    legally_authorized_to_work: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    work_auth_country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    citizenship_country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    at_least_18: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    has_non_compete: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    @property
    def education(self) -> list[dict]:
        if not self.education_json:
            return []
        try:
            parsed = json.loads(self.education_json)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
