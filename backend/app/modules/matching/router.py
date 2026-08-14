from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyJobRepo, SqlAlchemyResumeRepo
from app.common.errors import not_found
from app.core.deps import get_current_user, get_db, get_model_gateway
from app.modules.ai.gateway import ModelGateway
from app.modules.matching.service import rank_base_resumes, score_resume

router = APIRouter(prefix="/matching", tags=["matching"])


class ScoreRequest(BaseModel):
    job_id: int
    resume_id: int | None = None


class ScoreRead(BaseModel):
    id: int
    job_id: int
    resume_id: int
    must_have_coverage: float
    nice_to_have_coverage: float
    total_score: float
    embedding_namespace: str | None
    evidence_json: str
    recommended: bool = False

    class Config:
        from_attributes = True


class RankResponse(BaseModel):
    job_id: int
    recommended_resume_id: int | None
    scores: list[ScoreRead]


@router.post("/score", response_model=RankResponse)
def score_job(
    payload: ScoreRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    gateway: ModelGateway = Depends(get_model_gateway),
) -> RankResponse:
    job = SqlAlchemyJobRepo(db).get(payload.job_id)
    if not job or job.user_id != current_user.id:
        raise not_found("Job not found")
    if payload.resume_id is not None:
        resume = SqlAlchemyResumeRepo(db).get(payload.resume_id)
        if not resume or resume.user_id != current_user.id:
            raise not_found("Resume not found")
        saved, _ = score_resume(job, resume, gateway, db)
        job.recommended_resume_id = saved.resume_id
        SqlAlchemyJobRepo(db).update(job)
        scores = [saved]
    else:
        scores = rank_base_resumes(job, gateway, db)
    recommended = job.recommended_resume_id
    return RankResponse(
        job_id=job.id,
        recommended_resume_id=recommended,
        scores=[
            ScoreRead(
                id=item.id,
                job_id=item.job_id,
                resume_id=item.resume_id,
                must_have_coverage=item.must_have_coverage,
                nice_to_have_coverage=item.nice_to_have_coverage,
                total_score=item.total_score,
                embedding_namespace=item.embedding_namespace,
                evidence_json=item.evidence_json,
                recommended=item.resume_id == recommended,
            )
            for item in scores
        ],
    )
