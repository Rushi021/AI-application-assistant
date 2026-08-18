"""Write the tracker record for an application.

There is one application per job + resume. Logging the same pair twice updates the
existing row rather than adding a second, so reaching auto-apply and then marking
applied produces one entry, not two.

Company, role, resume family, and whether the resume was tailored are copied onto
the row. They are derivable by joining today, but the tracker is a historical
record: it should still read correctly after the job is edited or the resume is
replaced.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyApplicationRepo
from app.modules.applications.models import Application


def upsert_application(
    db: Session,
    *,
    user_id: int,
    job=None,
    resume=None,
    job_id: Optional[int] = None,
    resume_id: Optional[int] = None,
    status: str,
    tailor_run_id: Optional[int] = None,
    resume_tailored: Optional[bool] = None,
    document_path: Optional[str] = None,
    autofill_payload: Optional[str] = None,
) -> Application:
    repo = SqlAlchemyApplicationRepo(db)
    job_id = job.id if job is not None else job_id
    resume_id = resume.id if resume is not None else resume_id
    now = datetime.utcnow()

    application = repo.find_for_job_resume(user_id, job_id, resume_id)
    if application is None:
        application = Application(user_id=user_id, job_id=job_id, resume_id=resume_id)

    application.status = status
    application.status_updated_at = now
    # "Date applied" is set once, when the resume is handed over to be sent.
    if status in ("auto_apply", "applied") and application.applied_at is None:
        application.applied_at = now
    if tailor_run_id is not None:
        application.tailor_run_id = tailor_run_id
    if resume_tailored is not None:
        application.resume_tailored = resume_tailored
    if document_path is not None:
        application.document_path = document_path
    if autofill_payload is not None:
        application.autofill_payload = autofill_payload
    if job is not None:
        application.company_name = job.company_name
        application.role = job.role
    if resume is not None:
        application.resume_family = resume.family

    return repo.create(application) if application.id is None else repo.update(application)
