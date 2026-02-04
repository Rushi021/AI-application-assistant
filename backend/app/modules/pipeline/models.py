from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(50), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Inputs (job description and resume text; job description can be hardcoded by client)
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resume_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Outputs from parallel LLM calls
    tailored_resume: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
