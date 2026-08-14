from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    raw_text: Mapped[str] = mapped_column(Text)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sponsorship: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    date_posted: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    application_link: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    recommended_resume_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    requirements: Mapped[list["JobRequirement"]] = relationship(
        "JobRequirement",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="JobRequirement.order_index",
    )


class JobRequirement(Base):
    __tablename__ = "job_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("jobs.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20))  # must_have | nice_to_have
    category: Mapped[str] = mapped_column(String(50), default="skill")
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    job: Mapped[Job] = relationship("Job", back_populates="requirements")
