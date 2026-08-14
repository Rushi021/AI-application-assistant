from app.modules.jobs.models import JobRequirement
from app.modules.matching.exact import ExactHit
from app.modules.matching.scorer import aggregate
from app.modules.matching.semantic import SemanticHit


def test_must_haves_outrank_nice_to_haves():
    must = JobRequirement(job_id=1, text="Python", kind="must_have", category="skill", weight=1.0)
    nice = JobRequirement(job_id=1, text="Go", kind="nice_to_have", category="skill", weight=1.0)
    breakdown = aggregate(
        [must, nice],
        exact_hits=[ExactHit(requirement=must, resume_text="Python", matched_term="python")],
        semantic_hits=[],
        misses=[nice],
        must_have_weight=1.0,
        nice_to_have_weight=0.4,
    )
    assert breakdown.must_have_coverage == 1.0
    assert breakdown.nice_to_have_coverage == 0.0
    assert breakdown.total_score == round(1.0 / 1.4, 4)


def test_tier2_is_discounted():
    must = JobRequirement(job_id=1, text="vision", kind="must_have", category="skill", weight=1.0)
    breakdown = aggregate(
        [must],
        exact_hits=[],
        semantic_hits=[SemanticHit(requirement=must, resume_text="image classification", similarity=1.0)],
        misses=[],
        must_have_weight=1.0,
        nice_to_have_weight=0.4,
        tier2_confidence_factor=0.5,
    )
    assert abs(breakdown.must_have_coverage - 0.5) < 1e-6
    # No nice-to-haves ⇒ nice coverage is 1.0, so total is the weighted blend.
    assert abs(breakdown.total_score - round((0.5 * 1.0 + 1.0 * 0.4) / 1.4, 4)) < 1e-6
