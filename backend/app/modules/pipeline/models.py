from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(50), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Inputs: job description; resume as text and/or uploaded doc (resume_id)
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resume_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resume_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("resumes.id"), nullable=True, index=True
    )

    # Outputs from parallel LLM calls
    tailored_resume: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tailored_sections: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list of strings
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
