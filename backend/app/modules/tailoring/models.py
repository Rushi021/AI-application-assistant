from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TailorRun(Base):
    __tablename__ = "tailor_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("jobs.id"), index=True)
    resume_id: Mapped[int] = mapped_column(Integer, ForeignKey("resumes.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    do_tailor: Mapped[bool] = mapped_column(Boolean, default=True)
    personalized_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sections_json: Mapped[str] = mapped_column(Text, default="[]")
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_latex: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_pdf_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    compiler_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
