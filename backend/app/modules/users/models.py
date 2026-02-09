from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)

    # Google OAuth
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    picture_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # --- Basic info ---
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # --- Professional ---
    linkedin_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    portfolio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    github_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    years_of_experience: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_company: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- Education ---
    degree: Mapped[str | None] = mapped_column(String(255), nullable=True)
    field_of_study: Mapped[str | None] = mapped_column(String(255), nullable=True)
    university: Mapped[str | None] = mapped_column(String(255), nullable=True)
    graduation_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gpa: Mapped[float | None] = mapped_column(Float, nullable=True)

    # --- Work authorization ---
    visa_status: Mapped[str | None] = mapped_column(String(100), nullable=True)
    work_authorization: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sponsorship_needed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # --- Demographics (EEO) ---
    gender: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ethnicity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    veteran_status: Mapped[str | None] = mapped_column(String(100), nullable=True)
    disability_status: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # --- Salary ---
    expected_salary: Mapped[str | None] = mapped_column(String(50), nullable=True)
    current_salary: Mapped[str | None] = mapped_column(String(50), nullable=True)
    salary_currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="USD")

    # --- Custom fields (JSON blob for user-defined extras) ---
    custom_fields: Mapped[str | None] = mapped_column(Text, nullable=True)
