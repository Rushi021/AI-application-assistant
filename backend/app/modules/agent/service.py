"""Idempotent discovery/preparation and revision-bound application approval."""

from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import secrets
import re
from types import SimpleNamespace
from sqlalchemy import select, update, or_, delete
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.common.adapters.local_storage import LocalResumeStorage
from app.modules.agent.models import AgentPlan, AgentItem
from app.modules.agent.schemas import PlanConfig
from app.modules.agent.discovery import JobDiscovery, canonical
from app.modules.jobs.models import Job, JobRequirement
from app.modules.resumes.models import Resume
from app.modules.tailoring.models import TailorRun
from app.modules.profile.models import Profile
from app.modules.profile.schemas import ProfileRead
from app.modules.matching.service import score_resume
from app.modules.tailoring.router import create_run, finalize_run
from app.modules.tailoring.schemas import TailorCreate
from app.modules.applications.models import Application


def owned(db, model, row_id, user_id):
    obj = db.get(model, row_id)
    if not obj or obj.user_id != user_id:
        raise HTTPException(404, "Record not found")
    return obj


def files_for(run):
    resume = run.final_docx_key or run.final_pdf_key
    if not resume or not Path(resume).is_file():
        raise HTTPException(
            409, "Finalize a DOCX or compile the LaTeX resume to PDF first"
        )
    files = {"resume": resume}
    if run.final_docx_key and run.final_pdf_key and Path(run.final_pdf_key).is_file():
        files["resume_pdf"] = run.final_pdf_key
    if run.cover_document_key:
        if not Path(run.cover_document_key).is_file():
            raise HTTPException(409, "Cover letter file is missing; finalize again")
        files["cover_letter"] = run.cover_document_key
    if run.cover_pdf_key and Path(run.cover_pdf_key).is_file():
        files["cover_letter_pdf"] = run.cover_pdf_key
    return files


def digest(db, item):
    job = owned(db, Job, item.job_id, item.user_id)
    run = owned(db, TailorRun, item.run_id, item.user_id)
    if (
        run.resume_id != item.resume_id
        or run.job_id != item.job_id
        or run.status not in {"finalized", "auto_apply"}
    ):
        raise HTTPException(409, "Documents changed; finalize and approve again")
    profile = db.scalar(select(Profile).where(Profile.user_id == item.user_id))
    payload = {
        "job": job.raw_text,
        "url": canonical(job.application_link or ""),
        "resume": item.resume_id,
        "sections": run.sections_json,
        "cover": run.cover_letter,
        "profile": ProfileRead.model_validate(profile).model_dump(mode="json")
        if profile
        else {},
        "files": {
            k: hashlib.sha256(Path(v).read_bytes()).hexdigest()
            for k, v in files_for(run).items()
        },
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def applied_urls(db, user_id):
    urls = set()
    for url in db.scalars(
        select(Job.application_link)
        .join(Application, Application.job_id == Job.id)
        .where(Application.user_id == user_id, Application.status == "applied")
    ).all():
        try:
            urls.add(canonical(url or ""))
        except ValueError:
            pass
    return urls


def prepare(db, item, config, gateway, storage):
    try:
        resume = owned(db, Resume, item.resume_id, item.user_id)
        if resume.source_format not in {"tex", "docx"}:
            raise ValueError("Choose a DOCX or LaTeX source resume")
        job = owned(db, Job, item.job_id, item.user_id)
        item.attempts += 1
        item.state = "preparing"
        db.commit()
        score, _ = score_resume(job, resume, gateway, db)
        item.score = score.total_score
        item.evidence_json = score.evidence_json
        if score.total_score < config.minimum_score:
            item.state = "below_threshold"
            db.commit()
            return
        run = create_run(
            TailorCreate(
                job_id=job.id,
                resume_id=resume.id,
                do_tailor=True,
                personalized_instructions=config.instructions,
            ),
            current_user=SimpleNamespace(id=item.user_id),
            db=db,
            storage=storage,
            gateway=gateway,
        )
        item.run_id = run.id
        db.commit()
        stored_run = db.get(TailorRun, run.id)
        sections = json.loads(stored_run.sections_json)
        refused = 0
        for section in sections:
            for bullet in section.get("bullets", []):
                original, edited = (
                    bullet.get("original_text", ""),
                    bullet.get("text", ""),
                )
                if edited != original and (
                    len(edited) > len(original)
                    or "\n" in edited
                    or re.findall(r"\s{2,}|\t", original)
                    != re.findall(r"\s{2,}|\t", edited)
                ):
                    bullet["text"] = original
                    bullet["latex_source"] = bullet.get("latex_original") or bullet.get(
                        "latex_source"
                    )
                    refused += 1
        stored_run.sections_json = json.dumps(sections)
        db.commit()
        finalize_run(
            run.id,
            current_user=SimpleNamespace(id=item.user_id),
            db=db,
            storage=storage,
        )
        if refused:
            stored_run.compiler_warning = (
                (stored_run.compiler_warning or "")
                + f" | Format guard retained {refused} original lines: proposed edits exceeded the text budget or changed alignment whitespace."
            )
        item.state = "ready"
        item.error = None
        item.approval_digest = None
    except Exception as exc:
        db.rollback()
        item = db.get(AgentItem, item.id)
        item.state = "failed"
        # Model/provider exceptions can contain credentials. Do not persist raw exceptions.
        item.error = f"Preparation failed ({type(exc).__name__}). Check model configuration and source document; retry after correcting it."
    item.updated_at = datetime.utcnow()
    db.commit()


def run_plan(db, plan_id, gateway, discovery=None, storage=None, force=False):
    now = datetime.utcnow()
    query = update(AgentPlan).where(
        AgentPlan.id == plan_id,
        or_(AgentPlan.lease_until.is_(None), AgentPlan.lease_until < now),
    )
    if not force:
        query = query.where(
            or_(AgentPlan.enabled.is_(True), AgentPlan.run_once.is_(True)),
            AgentPlan.next_run <= now,
        )
    # A crashed worker lease expires; browser submission leases never auto-retry.
    if db.execute(query.values(lease_until=now + timedelta(hours=2))).rowcount != 1:
        db.rollback()
        return False
    db.commit()
    plan = db.get(AgentPlan, plan_id)
    config = PlanConfig.model_validate_json(plan.config_json)
    own_discovery = discovery is None
    discovery = discovery or JobDiscovery()
    storage = storage or LocalResumeStorage()
    try:
        postings, errors = discovery.search(config)
        already_applied = applied_urls(db, plan.user_id)
        for post in postings:
            if canonical(post.url) in already_applied:
                continue
            item = db.scalar(
                select(AgentItem).where(
                    AgentItem.user_id == plan.user_id,
                    AgentItem.fingerprint == post.fingerprint,
                )
            )
            if item:
                item.last_seen = now
                job = db.get(Job, item.job_id)
                if (
                    job
                    and job.raw_text != post.description
                    and item.state
                    not in {"filling", "submitted", "needs_attention", "rejected"}
                ):
                    job.raw_text = post.description
                    job.role = post.title
                    job.date_posted = post.published
                    db.execute(
                        delete(JobRequirement).where(JobRequirement.job_id == job.id)
                    )
                    item.state = "discovered"
                    item.approval_digest = None
                    item.attempts = 0
                    item.run_id = None
                    item.error = "The job description changed; preparing a new packet for review."
                continue
            job = Job(
                user_id=plan.user_id,
                raw_text=post.description,
                company_name=post.company,
                role=post.title,
                application_link=canonical(post.url),
                date_posted=post.published,
                source="scraped",
            )
            db.add(job)
            db.flush()
            db.add(
                AgentItem(
                    user_id=plan.user_id,
                    fingerprint=post.fingerprint,
                    job_id=job.id,
                    resume_id=config.resume_id,
                    source=post.source,
                    source_job_id=post.external_id,
                    location=post.location,
                )
            )
            try:
                db.commit()
            except IntegrityError:
                db.rollback()  # concurrent/import duplicate
        db.commit()
        # Stop after a bounded amount of model work; remaining rows persist for the next tick.
        items = db.scalars(
            select(AgentItem)
            .where(
                AgentItem.user_id == plan.user_id,
                AgentItem.state.in_(["discovered", "failed", "preparing"]),
                AgentItem.attempts < 3,
            )
            .order_by(AgentItem.id)
            .limit(config.max_prepare)
        ).all()
        for item in items:
            prepare(db, item, config, gateway, storage)
        plan.last_error = "\n".join(errors) or None
    except Exception as exc:
        db.rollback()
        plan = db.get(AgentPlan, plan_id)
        plan.last_error = (
            f"Discovery failed ({type(exc).__name__}); check source configuration."
        )
    finally:
        if own_discovery:
            discovery.close()
        plan.last_run = now
        plan.next_run = datetime.utcnow() + timedelta(minutes=config.interval_minutes)
        plan.lease_until = None
        plan.run_once = False
        db.commit()
    return True


def recover_browser_leases(db):
    db.execute(
        update(AgentItem)
        .where(AgentItem.state == "filling", AgentItem.lease_until < datetime.utcnow())
        .values(
            state="needs_attention",
            error="Browser session ended or timed out. Check the employer site before any retry.",
            updated_at=datetime.utcnow(),
        )
    )
    db.commit()


def claim(db, user_id, item_id=None):
    recover_browser_leases(db)
    query = (
        select(AgentItem)
        .where(AgentItem.user_id == user_id, AgentItem.state == "approved")
        .order_by(AgentItem.id)
    )
    if item_id:
        query = query.where(AgentItem.id == item_id)
    already_applied = applied_urls(db, user_id)
    for item in db.scalars(query).all():
        job = db.get(Job, item.job_id)
        if job and canonical(job.application_link or "") in already_applied:
            item.state = "needs_attention"
            item.error = (
                "This posting is already recorded as applied. Check the tracker."
            )
            db.commit()
            continue
        try:
            valid = secrets.compare_digest(item.approval_digest or "", digest(db, item))
        except (HTTPException, ValueError):
            valid = False
        if not valid:
            item.state = "ready"
            item.approval_digest = None
            item.error = "Packet or profile changed. Review and approve again."
            db.commit()
            continue
        token = secrets.token_urlsafe(32)
        taken = db.execute(
            update(AgentItem)
            .where(AgentItem.id == item.id, AgentItem.state == "approved")
            .values(
                state="filling",
                lease_token=token,
                lease_until=datetime.utcnow() + timedelta(minutes=15),
                updated_at=datetime.utcnow(),
            )
        ).rowcount
        db.commit()
        if taken:
            db.refresh(item)
            return packet(db, item, include_token=True)
    return None


def packet(db, item, include_token=False):
    job = owned(db, Job, item.job_id, item.user_id)
    run = owned(db, TailorRun, item.run_id, item.user_id) if item.run_id else None
    profile = db.scalar(select(Profile).where(Profile.user_id == item.user_id))
    value = {
        "id": item.id,
        "job_id": item.job_id,
        "resume_id": item.resume_id,
        "run_id": item.run_id,
        "company": job.company_name,
        "role": job.role,
        "url": job.application_link,
        "description": job.raw_text,
        "source": item.source,
        "location": item.location,
        "state": item.state,
        "score": item.score,
        "evidence": json.loads(item.evidence_json),
        "error": item.error,
        "attempts": item.attempts,
        "cover_letter": run.cover_letter if run else None,
        "warning": run.compiler_warning if run else None,
        "updated_at": item.updated_at,
        "discovered_at": item.discovered_at,
    }
    if include_token:
        value["lease_token"] = item.lease_token
        value["profile"] = (
            ProfileRead.model_validate(profile).model_dump(mode="json")
            if profile
            else {}
        )
        value["documents"] = list(files_for(run))
    return value
