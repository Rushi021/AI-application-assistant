"""Tier 0 — LLM extraction only. Never contributes to the numeric score."""

from __future__ import annotations

from app.common.adapters.sqlalchemy_repos import SqlAlchemyRequirementRepo
from app.modules.ai.gateway import ModelGateway
from app.modules.ai.prompts.pipeline import build_extraction_prompt
from app.modules.jobs.models import Job, JobRequirement
from app.modules.matching.schemas import RequirementList
from sqlalchemy.orm import Session


def extract_requirements(job: Job, gateway: ModelGateway, db: Session) -> list[JobRequirement]:
    repo = SqlAlchemyRequirementRepo(db)
    existing = repo.list_for_job(job.id)
    if existing:
        return existing
    parsed = gateway.generate_json("jd_extraction", build_extraction_prompt(job.raw_text), RequirementList)
    rows: list[JobRequirement] = []
    for index, item in enumerate(parsed.requirements):
        text = item.text.strip()
        if not text:
            continue
        rows.append(
            JobRequirement(
                job_id=job.id,
                text=text,
                kind=item.kind,
                category=item.category or "skill",
                weight=item.weight or 1.0,
                order_index=index,
            )
        )
    return repo.replace_for_job(job.id, rows)
