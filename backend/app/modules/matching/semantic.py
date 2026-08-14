"""Tier 2 — semantic/embedding fallback. Runs only on tier-1 misses."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyEmbeddingCacheRepo
from app.core.config import get_settings
from app.modules.ai.gateway import ModelGateway
from app.modules.jobs.models import JobRequirement


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class SemanticHit:
    requirement: JobRequirement
    resume_text: str
    similarity: float


@dataclass
class SemanticResult:
    hits: list[SemanticHit]
    misses: list[JobRequirement]
    namespace: str
    embed_call_count: int


def _cached_embed(
    texts: list[str],
    task: str,
    gateway: ModelGateway,
    db: Session,
) -> tuple[list[list[float]], str, int]:
    if not texts:
        provider = gateway.embedding_for(task)
        return [], provider.namespace, 0
    repo = SqlAlchemyEmbeddingCacheRepo(db)
    provider = gateway.embedding_for(task)
    namespace = provider.namespace
    vectors: list[list[float] | None] = [None] * len(texts)
    missing_idx: list[int] = []
    for i, text in enumerate(texts):
        row = repo.get(_sha(text), namespace)
        if row:
            vectors[i] = json.loads(row.vector_json)
        else:
            missing_idx.append(i)
    calls = 0
    if missing_idx:
        fresh = gateway.embed(task, [texts[i] for i in missing_idx])
        namespace = fresh.namespace
        calls = 1
        for offset, i in enumerate(missing_idx):
            vec = fresh.vectors[offset]
            vectors[i] = vec
            repo.put(_sha(texts[i]), namespace, json.dumps(vec))
    filled = [v if v is not None else [] for v in vectors]
    return filled, namespace, calls


def match_semantic(
    unmatched: list[JobRequirement],
    resume_chunks: list[str],
    gateway: ModelGateway,
    db: Session,
    *,
    threshold: float | None = None,
) -> SemanticResult:
    settings = get_settings()
    cutoff = settings.semantic_threshold if threshold is None else threshold
    if not unmatched or not resume_chunks:
        provider = gateway.embedding_for("requirement_embedding")
        return SemanticResult(hits=[], misses=list(unmatched), namespace=provider.namespace, embed_call_count=0)

    req_vecs, namespace, calls_req = _cached_embed(
        [req.text for req in unmatched], "requirement_embedding", gateway, db
    )
    chunk_vecs, chunk_ns, calls_chunk = _cached_embed(resume_chunks, "resume_embedding", gateway, db)
    namespace = namespace or chunk_ns

    hits: list[SemanticHit] = []
    misses: list[JobRequirement] = []
    for req, req_vec in zip(unmatched, req_vecs):
        best_sim = -1.0
        best_chunk = ""
        for chunk, chunk_vec in zip(resume_chunks, chunk_vecs):
            sim = cosine(req_vec, chunk_vec)
            if sim > best_sim:
                best_sim = sim
                best_chunk = chunk
        if best_sim >= cutoff:
            hits.append(SemanticHit(requirement=req, resume_text=best_chunk[:400], similarity=best_sim))
        else:
            misses.append(req)
    return SemanticResult(
        hits=hits,
        misses=misses,
        namespace=namespace,
        embed_call_count=calls_req + calls_chunk,
    )
