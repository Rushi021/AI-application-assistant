from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Inputs
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resume_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resume_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("resumes.id"), nullable=True, index=True,
    )
    tailor_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cover_letter_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Outputs
    tailored_resume: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tailored_sections: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_pipeline_runs_session_id_id", "session_id", "id"),
    )
