from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="applied")
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    portal_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    job_board: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    salary: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    resume_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    resume_source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_applications_session_id_id", "session_id", "id"),
        CheckConstraint(
            "status IN ('applied','assessment','interview_round_1','interview_round_2',"
            "'interview_round_3','offer','rejected','withdrawn')",
            name="ck_applications_status",
        ),
    )


class ApplicationEvent(Base):
    """Append-only audit log for application lifecycle events."""
    __tablename__ = "application_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    application_id: Mapped[int] = mapped_column(Integer, index=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(50))  # e.g. autofill_start, autofill_stop, submit
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
