"""Aggregate tier-1 and tier-2 hits into coverage scores. No model calls."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.config import get_settings
from app.modules.jobs.models import JobRequirement
from app.modules.matching.exact import ExactHit
from app.modules.matching.semantic import SemanticHit


@dataclass
class EvidenceItem:
    requirement: str
    kind: str
    tier: int
    resume_text: str = ""
    similarity: float | None = None
    matched_term: str | None = None


@dataclass
class ScoreBreakdown:
    must_have_coverage: float
    nice_to_have_coverage: float
    total_score: float
    evidence: list[EvidenceItem] = field(default_factory=list)


def _coverage(
    reqs: list[JobRequirement],
    hit_weight: dict[int, float],
) -> float:
    if not reqs:
        return 1.0
    denom = sum(r.weight or 1.0 for r in reqs) or 1.0
    numer = 0.0
    for req in reqs:
        numer += (req.weight or 1.0) * hit_weight.get(id(req), 0.0)
    return numer / denom


def aggregate(
    requirements: list[JobRequirement],
    exact_hits: list[ExactHit],
    semantic_hits: list[SemanticHit],
    misses: list[JobRequirement],
    *,
    must_have_weight: float | None = None,
    nice_to_have_weight: float | None = None,
    tier2_confidence_factor: float | None = None,
) -> ScoreBreakdown:
    settings = get_settings()
    mw = settings.must_have_weight if must_have_weight is None else must_have_weight
    nw = settings.nice_to_have_weight if nice_to_have_weight is None else nice_to_have_weight
    t2 = settings.tier2_confidence_factor if tier2_confidence_factor is None else tier2_confidence_factor
    hit_weight: dict[int, float] = {}
    evidence: list[EvidenceItem] = []

    for hit in exact_hits:
        hit_weight[id(hit.requirement)] = 1.0
        evidence.append(
            EvidenceItem(
                requirement=hit.requirement.text,
                kind=hit.requirement.kind,
                tier=1,
                resume_text=hit.resume_text,
                similarity=1.0,
                matched_term=hit.matched_term,
            )
        )
    for hit in semantic_hits:
        factor = t2 * max(0.0, min(1.0, hit.similarity))
        hit_weight[id(hit.requirement)] = factor
        evidence.append(
            EvidenceItem(
                requirement=hit.requirement.text,
                kind=hit.requirement.kind,
                tier=2,
                resume_text=hit.resume_text,
                similarity=hit.similarity,
            )
        )
    for req in misses:
        evidence.append(EvidenceItem(requirement=req.text, kind=req.kind, tier=0))

    must = [r for r in requirements if r.kind == "must_have"]
    nice = [r for r in requirements if r.kind != "must_have"]
    must_cov = _coverage(must, hit_weight)
    nice_cov = _coverage(nice, hit_weight)
    total = (mw * must_cov + nw * nice_cov) / (mw + nw) if (mw + nw) else must_cov
    return ScoreBreakdown(
        must_have_coverage=round(must_cov, 4),
        nice_to_have_coverage=round(nice_cov, 4),
        total_score=round(total, 4),
        evidence=evidence,
    )
