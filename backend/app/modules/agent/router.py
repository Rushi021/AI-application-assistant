from datetime import datetime
import base64
import mimetypes
from pathlib import Path
from typing import Literal
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from app.core.deps import get_current_user, get_db
from app.modules.agent.models import AgentPlan, AgentItem
from app.modules.agent.schemas import PlanConfig, Decision, Result, Claim
from app.modules.agent import service
from app.modules.agent.discovery import canonical
from app.modules.resumes.models import Resume
from app.modules.jobs.models import Job
from app.modules.tailoring.models import TailorRun
from app.modules.applications.service import upsert_application

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/plan")
def get_plan(user=Depends(get_current_user), db=Depends(get_db)):
    plan = db.scalar(select(AgentPlan).where(AgentPlan.user_id == user.id))
    return {
        "config": PlanConfig.model_validate_json(plan.config_json).model_dump()
        if plan
        else None,
        "last_run": plan.last_run if plan else None,
        "next_run": plan.next_run if plan else None,
        "error": plan.last_error if plan else None,
        "running": bool(
            plan and plan.lease_until and plan.lease_until > datetime.utcnow()
        ),
    }


@router.put("/plan")
def save_plan(config: PlanConfig, user=Depends(get_current_user), db=Depends(get_db)):
    resume = service.owned(db, Resume, config.resume_id, user.id)
    if resume.source_format not in {"tex", "docx"}:
        raise HTTPException(422, "Choose a DOCX or LaTeX source resume")
    plan = db.scalar(select(AgentPlan).where(AgentPlan.user_id == user.id))
    if not plan:
        plan = AgentPlan(user_id=user.id)
        db.add(plan)
    plan.config_json = config.model_dump_json()
    plan.enabled = config.enabled
    plan.next_run = datetime.utcnow()
    db.commit()
    return get_plan(user, db)


@router.post("/wake")
def wake(user=Depends(get_current_user), db=Depends(get_db)):
    plan = db.scalar(select(AgentPlan).where(AgentPlan.user_id == user.id))
    if plan and plan.enabled:
        # Do not reset the due time on every popup open (avoids repeated scans/model calls).
        return {"scheduled": True, "next_run": plan.next_run}
    return {"scheduled": False}


@router.post("/scan")
def scan(user=Depends(get_current_user), db=Depends(get_db)):
    plan = db.scalar(select(AgentPlan).where(AgentPlan.user_id == user.id))
    if not plan:
        raise HTTPException(409, "Save an agent plan first")
    if plan.lease_until and plan.lease_until > datetime.utcnow():
        raise HTTPException(409, "A scan is already running")
    plan.next_run = datetime.utcnow()
    plan.run_once = True
    db.commit()
    return {"scheduled": True}


@router.get("/queue")
def queue(user=Depends(get_current_user), db=Depends(get_db)):
    service.recover_browser_leases(db)
    return [
        service.packet(db, i)
        for i in db.scalars(
            select(AgentItem)
            .where(AgentItem.user_id == user.id)
            .order_by(AgentItem.id.desc())
            .limit(200)
        ).all()
    ]


@router.post("/queue/{item_id}/decision")
def decide(
    item_id: int, choice: Decision, user=Depends(get_current_user), db=Depends(get_db)
):
    item = service.owned(db, AgentItem, item_id, user.id)
    if item.state in {"filling", "submitted"}:
        raise HTTPException(409, "An application is in progress or already submitted")
    if choice.action == "approve":
        if item.state != "ready":
            raise HTTPException(409, "Prepare and review this packet before approving")
        try:
            item.approval_digest = service.digest(db, item)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        if not db.get(TailorRun, item.run_id).cover_document_key:
            raise HTTPException(409, "Finalize the cover letter first")
        item.state = "approved"
    elif choice.action == "reject":
        item.state = "rejected"
        item.approval_digest = None
    else:
        if item.state == "needs_attention":
            raise HTTPException(
                409, "Check submission history before preparing a new application"
            )
        plan = db.scalar(select(AgentPlan).where(AgentPlan.user_id == user.id))
        if not plan:
            raise HTTPException(409, "Save a plan first")
        item.resume_id = (
            choice.resume_id
            or PlanConfig.model_validate_json(plan.config_json).resume_id
        )
        service.owned(db, Resume, item.resume_id, user.id)
        item.state = "discovered"
        item.attempts = 0
        item.run_id = None
        item.approval_digest = None
        plan.next_run = datetime.utcnow()
        plan.run_once = True
    item.error = None
    item.updated_at = datetime.utcnow()
    db.commit()
    return service.packet(db, item)


@router.post("/claim")
def claim(payload: Claim, user=Depends(get_current_user), db=Depends(get_db)):
    return service.claim(db, user.id, payload.item_id)


@router.get("/queue/{item_id}/documents/{kind}")
def document(
    item_id: int,
    kind: str,
    lease_token: str | None = None,
    download: bool = False,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    item = service.owned(db, AgentItem, item_id, user.id)
    run = service.owned(db, TailorRun, item.run_id, user.id)
    path = service.files_for(run).get(kind)
    if not path:
        raise HTTPException(404, "Document not found")
    if lease_token:
        if (
            item.state != "filling"
            or item.lease_token != lease_token
            or item.lease_until < datetime.utcnow()
        ):
            raise HTTPException(409, "Browser lease expired")
        if item.approval_digest != service.digest(db, item):
            raise HTTPException(409, "Packet changed after approval")
    if download:
        return FileResponse(path, filename=Path(path).name)
    return {
        "name": Path(path).name,
        "type": mimetypes.guess_type(path)[0] or "application/octet-stream",
        "base64": base64.b64encode(Path(path).read_bytes()).decode(),
    }


@router.post("/queue/{item_id}/result")
def result(
    item_id: int, payload: Result, user=Depends(get_current_user), db=Depends(get_db)
):
    item = service.owned(db, AgentItem, item_id, user.id)
    if (
        item.state != "filling"
        or item.lease_token != payload.lease_token
        or item.lease_until < datetime.utcnow()
    ):
        raise HTTPException(409, "Invalid or expired browser lease")
    job = service.owned(db, Job, item.job_id, user.id)
    try:
        if (
            canonical(payload.url).split("/", 3)[2]
            != canonical(job.application_link).split("/", 3)[2]
        ):
            raise ValueError()
    except ValueError:
        raise HTTPException(409, "Application destination changed; review it manually")
    item.state = payload.state
    item.error = payload.detail or None
    item.updated_at = datetime.utcnow()
    item.lease_token = None
    item.lease_until = None
    if payload.state == "submitted":
        resume = service.owned(db, Resume, item.resume_id, user.id)
        run = service.owned(db, TailorRun, item.run_id, user.id)
        upsert_application(
            db,
            user_id=user.id,
            job=job,
            resume=resume,
            status="applied",
            tailor_run_id=run.id,
            resume_tailored=True,
            document_path=service.files_for(run)["resume"],
        )
    db.commit()
    return service.packet(db, item)


@router.post("/from-run/{run_id}")
def enqueue_manual(run_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    import hashlib

    run = service.owned(db, TailorRun, run_id, user.id)
    job = service.owned(db, Job, run.job_id, user.id)
    try:
        fingerprint = hashlib.sha256(
            canonical(job.application_link or "").encode()
        ).hexdigest()
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    item = db.scalar(
        select(AgentItem).where(
            AgentItem.user_id == user.id, AgentItem.fingerprint == fingerprint
        )
    )
    if item and item.state in {"filling", "submitted", "needs_attention"}:
        raise HTTPException(
            409, "Check the existing application before creating another"
        )
    if not item:
        item = AgentItem(
            user_id=user.id,
            fingerprint=fingerprint,
            job_id=job.id,
            resume_id=run.resume_id,
            source="manual",
        )
        db.add(item)
    item.job_id = job.id
    item.resume_id = run.resume_id
    item.run_id = run.id
    item.state = "ready"
    item.approval_digest = None
    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return service.packet(db, item)


class ManualResolution(BaseModel):
    outcome: Literal["submitted", "not_submitted"]


@router.post("/queue/{item_id}/resolve")
def resolve(
    item_id: int,
    payload: ManualResolution,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    item = service.owned(db, AgentItem, item_id, user.id)
    if item.state != "needs_attention":
        raise HTTPException(409, "Only uncertain attempts need manual resolution")
    if payload.outcome == "submitted":
        job = service.owned(db, Job, item.job_id, user.id)
        resume = service.owned(db, Resume, item.resume_id, user.id)
        run = service.owned(db, TailorRun, item.run_id, user.id)
        upsert_application(
            db,
            user_id=user.id,
            job=job,
            resume=resume,
            status="applied",
            tailor_run_id=run.id,
            resume_tailored=True,
            document_path=service.files_for(run)["resume"],
        )
        item.state = "submitted"
        item.error = "Employer receipt confirmed manually by user."
    else:
        item.state = "ready"
        item.approval_digest = None
        item.error = "User verified no submission. Review and approve again before another attempt."
    item.lease_token = None
    item.lease_until = None
    item.updated_at = datetime.utcnow()
    db.commit()
    return service.packet(db, item)


class LeaseCheck(BaseModel):
    lease_token: str


@router.post("/queue/{item_id}/validate")
def validate_lease(
    item_id: int,
    payload: LeaseCheck,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    item = service.owned(db, AgentItem, item_id, user.id)
    if (
        item.state != "filling"
        or item.lease_token != payload.lease_token
        or item.lease_until < datetime.utcnow()
    ):
        raise HTTPException(409, "Execution lease expired")
    if item.approval_digest != service.digest(db, item):
        raise HTTPException(409, "Packet changed after approval; submission must stop")
    return {"valid": True}
