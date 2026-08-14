"""Score Alignment: tier 0 → 1 → 2, then rank base resumes."""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import (
    SqlAlchemyJobRepo,
    SqlAlchemyMatchScoreRepo,
    SqlAlchemyResumeRepo,
    SqlAlchemyResumeSectionRepo,
)
from app.modules.ai.gateway import ModelGateway
from app.modules.jobs.models import Job
from app.modules.matching.exact import match_exact
from app.modules.matching.extraction import extract_requirements
from app.modules.matching.models import MatchScore
from app.modules.matching.scorer import EvidenceItem, ScoreBreakdown, aggregate
from app.modules.matching.semantic import match_semantic
from app.modules.resumes.models import Resume


def resume_chunks(resume: Resume, db: Session) -> list[str]:
    sections = SqlAlchemyResumeSectionRepo(db).list_sections(resume.id)
    chunks: list[str] = []
    for section in sections:
        if section.body_text:
            chunks.append(section.body_text)
        for bullet in section.bullets:
            if bullet.text:
                chunks.append(bullet.text)
    if not chunks:
        chunks.append(resume.original_filename)
    return chunks


def _evidence_json(items: list[EvidenceItem]) -> str:
    return json.dumps(
        [
            {
                "requirement": item.requirement,
                "kind": item.kind,
                "tier": item.tier,
                "resume_text": item.resume_text,
                "similarity": item.similarity,
                "matched_term": item.matched_term,
            }
            for item in items
        ]
    )


def score_resume(
    job: Job,
    resume: Resume,
    gateway: ModelGateway,
    db: Session,
) -> tuple[MatchScore, ScoreBreakdown]:
    requirements = extract_requirements(job, gateway, db)
    chunks = resume_chunks(resume, db)
    exact = match_exact(requirements, chunks)
    semantic = match_semantic(exact.unmatched, chunks, gateway, db)
    breakdown = aggregate(requirements, exact.hits, semantic.hits, semantic.misses)
    row = MatchScore(
        user_id=job.user_id,
        job_id=job.id,
        resume_id=resume.id,
        must_have_coverage=breakdown.must_have_coverage,
        nice_to_have_coverage=breakdown.nice_to_have_coverage,
        total_score=breakdown.total_score,
        embedding_namespace=semantic.namespace,
        evidence_json=_evidence_json(breakdown.evidence),
    )
    saved = SqlAlchemyMatchScoreRepo(db).create(row)
    return saved, breakdown


def rank_base_resumes(
    job: Job,
    gateway: ModelGateway,
    db: Session,
) -> list[MatchScore]:
    resumes = list(SqlAlchemyResumeRepo(db).list_by_user(job.user_id, active_only=True))
    scores: list[MatchScore] = []
    for resume in resumes:
        saved, _ = score_resume(job, resume, gateway, db)
        scores.append(saved)
    scores.sort(key=lambda item: item.total_score, reverse=True)
    if scores:
        job.recommended_resume_id = scores[0].resume_id
        SqlAlchemyJobRepo(db).update(job)
    return scores
