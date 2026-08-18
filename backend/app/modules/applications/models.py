from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

APPLICATION_STATUSES = ("draft", "auto_apply", "applied", "failed")


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    job_id: Mapped[int] = mapped_column(Integer, index=True)
    resume_id: Mapped[int] = mapped_column(Integer, index=True)
    tailor_run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    outcome: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    autofill_payload: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Copied onto the row so a tracker entry still reads correctly after the job or
    # resume it came from is edited or deleted.
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    resume_family: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    resume_tailored: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    document_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


# Columns added after the first create_all on an existing local SQLite file.
APPLICATION_SQLITE_COLUMNS: dict[str, str] = {
    "company_name": "VARCHAR(255)",
    "role": "VARCHAR(255)",
    "resume_family": "VARCHAR(50)",
    "resume_tailored": "BOOLEAN",
    "document_path": "VARCHAR(500)",
}
