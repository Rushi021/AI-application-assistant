"""Persist model call telemetry. Adapters never write this themselves."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.modules.ai.ports import ModelCallRecord, UsageLogger


class ModelCall(Base):
    __tablename__ = "model_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    task: Mapped[str] = mapped_column(String(100), index=True)
    provider: Mapped[str] = mapped_column(String(50), index=True)
    model: Mapped[str] = mapped_column(String(200))
    latency_ms: Mapped[float] = mapped_column(Float)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SqlAlchemyUsageLogger(UsageLogger):
    """Opens its own short-lived session so logging is safe from worker threads."""

    def record(self, call: ModelCallRecord) -> None:
        from app.db import session as db_session

        db = db_session.SessionLocal()
        try:
            db.add(
                ModelCall(
                    task=call.task,
                    provider=call.provider,
                    model=call.model,
                    latency_ms=call.latency_ms,
                    success=call.success,
                    input_tokens=call.input_tokens,
                    output_tokens=call.output_tokens,
                    error=call.error,
                )
            )
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
