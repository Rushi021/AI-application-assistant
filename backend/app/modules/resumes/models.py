from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

RESUME_FAMILIES = ("ai_ml", "data_science", "data_analyst", "business_analyst")


class Resume(Base):
    __tablename__ = "resumes"
    __table_args__ = (UniqueConstraint("user_id", "family", "version", name="uq_resume_family_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    file_key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    family: Mapped[str] = mapped_column(String(50), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    source_format: Mapped[str] = mapped_column(String(20), default="tex")
    template_preamble: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sections: Mapped[list["ResumeSection"]] = relationship(
        "ResumeSection", back_populates="resume", cascade="all, delete-orphan", order_by="ResumeSection.order_index"
    )


class ResumeSection(Base):
    __tablename__ = "resume_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    resume_id: Mapped[int] = mapped_column(Integer, ForeignKey("resumes.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    body_text: Mapped[str] = mapped_column(Text, default="")
    latex_source: Mapped[str] = mapped_column(Text, default="")

    resume: Mapped[Resume] = relationship("Resume", back_populates="sections")
    bullets: Mapped[list["ResumeBullet"]] = relationship(
        "ResumeBullet",
        back_populates="section",
        cascade="all, delete-orphan",
        order_by="ResumeBullet.order_index",
    )


class ResumeBullet(Base):
    __tablename__ = "resume_bullets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    section_id: Mapped[int] = mapped_column(Integer, ForeignKey("resume_sections.id"), index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    latex_source: Mapped[str] = mapped_column(Text, default="")

    section: Mapped[ResumeSection] = relationship("ResumeSection", back_populates="bullets")
