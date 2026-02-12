"""Draft models: per-section editing workflow with chat memory."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ResumeDraft(Base):
    """One draft per review/edit cycle. Linked to a pipeline run or directly to a base resume."""
    __tablename__ = "resume_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    run_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("pipeline_runs.id"), nullable=True, index=True,
    )
    base_resume_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("resumes.id"), nullable=False,
    )
    starting_source: Mapped[str] = mapped_column(String(20), default="base")  # 'base' or 'tailored'
    status: Mapped[str] = mapped_column(String(20), default="drafting")  # drafting / approved / applied
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cover_letter: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_resume_drafts_session_id_id", "session_id", "id"),
    )


class ResumeDraftSection(Base):
    """One row per section within a draft, in display order."""
    __tablename__ = "resume_draft_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("resume_drafts.id"), nullable=False, index=True,
    )
    section_id: Mapped[str] = mapped_column(String(100), nullable=False)  # e.g. 'experience', 'projects'
    section_title: Mapped[str] = mapped_column(String(255), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    current_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    proposed_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_feedback: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # liked / disliked / null
    editable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    section_group: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # main section header e.g. WORK EXPERIENCE
    para_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # starting paragraph index in docx
    para_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)    # ending paragraph index (exclusive)

    __table_args__ = (
        Index("ix_draft_sections_draft_id_order", "draft_id", "order_index"),
    )


class SectionChatMessage(Base):
    """Multi-turn conversation per section within a draft (persistent memory)."""
    __tablename__ = "section_chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("resume_drafts.id"), nullable=False, index=True,
    )
    section_id: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user / assistant / system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_section_chat_draft_section", "draft_id", "section_id", "turn_index"),
    )
