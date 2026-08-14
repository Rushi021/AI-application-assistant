from app.db import session as db_session
from app.db.base import Base
from app.modules.ai.gateway import ModelGateway
from app.modules.jobs.models import JobRequirement
from app.modules.matching.exact import match_exact
from app.modules.matching.models import EmbeddingCache  # noqa: F401
from app.modules.matching.semantic import match_semantic


def test_tier2_only_runs_for_unmatched(tmp_path):
    engine = db_session.configure_engine(f"sqlite:///{tmp_path / 't.db'}")
    Base.metadata.create_all(bind=engine)
    db = db_session.SessionLocal()
    try:
        python = JobRequirement(job_id=1, text="Python", kind="must_have", category="skill", weight=1.0)
        vision = JobRequirement(
            job_id=1, text="computer vision", kind="must_have", category="skill", weight=1.0
        )
        chunks = ["Python developer with image classification experience"]
        exact = match_exact([python, vision], chunks)
        assert [h.requirement.text for h in exact.hits] == ["Python"]
        assert [u.text for u in exact.unmatched] == ["computer vision"]

        gateway = ModelGateway()
        semantic = match_semantic(exact.unmatched, chunks, gateway, db, threshold=0.0)
        assert semantic.embed_call_count >= 1
        assert len(semantic.hits) + len(semantic.misses) == 1
    finally:
        db.close()
