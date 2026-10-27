from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


TAILOR_STATUSES = ("draft", "ready", "finalized", "auto_apply")


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
    final_tex_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    final_docx_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    final_pdf_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    cover_pdf_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    cover_document_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    cover_template_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    compiler_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Where the auto-apply step filed the documents in the local library.
    export_dir: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    exported_docx_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    exported_pdf_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    exported_tex_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# Columns added after the first create_all on an existing local SQLite file.
TAILOR_RUN_SQLITE_COLUMNS: dict[str, str] = {
    "cover_pdf_key": "VARCHAR(500)",
    "cover_document_key": "VARCHAR(500)",
    "cover_template_key": "VARCHAR(500)",
    "final_tex_key": "VARCHAR(500)",
    "final_docx_key": "VARCHAR(500)",
    "export_dir": "VARCHAR(500)",
    "exported_docx_path": "VARCHAR(500)",
    "exported_pdf_path": "VARCHAR(500)",
    "exported_tex_path": "VARCHAR(500)",
}
