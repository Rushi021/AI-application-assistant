"""Tier 1 — exact keyword match. Zero API calls. First pass before embeddings."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.modules.jobs.models import JobRequirement
from app.modules.matching.aliases import ALIASES

_NON_ALNUM = re.compile(r"[^a-z0-9+#.]+")


def normalize(text: str) -> str:
    lowered = text.casefold().replace("’", "'")
    collapsed = _NON_ALNUM.sub(" ", lowered)
    tokens = [ALIASES.get(tok, tok) for tok in collapsed.split() if tok]
    # Re-join aliases that expanded into multi-word phrases.
    joined = " ".join(tokens)
    tokens = [ALIASES.get(tok, tok) for tok in joined.split() if tok]
    return " ".join(tokens)


def _singular(token: str) -> str:
    if len(token) > 3 and token.endswith("es") and token[:-2] in ALIASES.values():
        return token[:-2]
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _needle_pattern(needle: str) -> str:
    parts = [re.escape(_singular(part)) + "s?" for part in needle.split() if part]
    if not parts:
        return r"$^"
    inner = r"[\s\-]+".join(parts)
    return rf"(?<![a-z0-9+#.]){inner}(?![a-z0-9+#.])"


@dataclass
class ExactHit:
    requirement: JobRequirement
    resume_text: str
    matched_term: str


@dataclass
class ExactResult:
    hits: list[ExactHit]
    unmatched: list[JobRequirement]


def match_exact(requirements: list[JobRequirement], resume_chunks: list[str]) -> ExactResult:
    haystack = normalize(" \n ".join(resume_chunks))
    hits: list[ExactHit] = []
    unmatched: list[JobRequirement] = []
    for req in requirements:
        terms = {normalize(req.text)}
        alias = ALIASES.get(req.text.casefold().strip())
        if alias:
            terms.add(normalize(alias))
        matched_term = None
        for term in terms:
            if not term:
                continue
            if re.search(_needle_pattern(term), haystack):
                matched_term = term
                break
        if matched_term:
            snippet = next((chunk for chunk in resume_chunks if normalize(req.text).split()[:1] and True), resume_chunks[0] if resume_chunks else "")
            # Prefer the chunk that actually contains the term.
            for chunk in resume_chunks:
                if re.search(_needle_pattern(matched_term), normalize(chunk)):
                    snippet = chunk
                    break
            hits.append(ExactHit(requirement=req, resume_text=snippet[:400], matched_term=matched_term))
        else:
            unmatched.append(req)
    return ExactResult(hits=hits, unmatched=unmatched)
