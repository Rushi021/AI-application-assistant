"""Durable preparation queue. Approval and browser execution are separate states."""

from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AgentPlan(Base):
    __tablename__ = "agent_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    run_once: Mapped[bool] = mapped_column(Boolean, default=False)
    next_run: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentItem(Base):
    __tablename__ = "agent_items"
    __table_args__ = (UniqueConstraint("user_id", "fingerprint"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    job_id: Mapped[int] = mapped_column(Integer, index=True)
    resume_id: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(100))
    source_job_id: Mapped[str] = mapped_column(String(1000), default="")
    location: Mapped[str] = mapped_column(String(255), default="")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence_json: Mapped[str] = mapped_column(Text, default="[]")
    state: Mapped[str] = mapped_column(String(30), default="discovered", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    discovered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
