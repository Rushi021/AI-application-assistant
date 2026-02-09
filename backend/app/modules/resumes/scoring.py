"""
Resume-vs-JD scoring (MVP): deterministic keyword overlap + title match.
Returns a 0-100 score and a short rationale.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Set


@dataclass
class ScoreResult:
    score: int  # 0-100
    matched_keywords: list[str]
    missing_keywords: list[str]
    rationale: str


# Common filler words to exclude from keyword extraction
_STOP_WORDS: Set[str] = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "need", "dare",
    "this", "that", "these", "those", "i", "you", "he", "she", "it", "we",
    "they", "me", "him", "her", "us", "them", "my", "your", "his", "its",
    "our", "their", "what", "which", "who", "whom", "where", "when", "why",
    "how", "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "no", "not", "only", "own", "same", "so", "than",
    "too", "very", "just", "about", "above", "after", "again", "also",
    "any", "as", "because", "before", "between", "during", "if", "into",
    "over", "through", "under", "until", "up", "while", "work", "working",
    "experience", "ability", "able", "team", "role", "company", "job",
    "including", "using", "new", "well", "strong", "good", "like",
    "etc", "required", "preferred", "plus", "minimum", "years", "year",
}


def _extract_keywords(text: str) -> Set[str]:
    """Extract meaningful lowercase keywords (2+ chars, not stop words)."""
    words = set(re.findall(r"[a-z][a-z0-9+#./-]{1,}", text.lower()))
    return words - _STOP_WORDS


def score_resume_against_jd(resume_text: str, job_description: str) -> ScoreResult:
    """
    Score how well resume_text aligns with job_description.
    MVP: keyword overlap percentage + penalties for missing important terms.
    """
    jd_keywords = _extract_keywords(job_description)
    resume_keywords = _extract_keywords(resume_text)

    if not jd_keywords:
        return ScoreResult(
            score=50,
            matched_keywords=[],
            missing_keywords=[],
            rationale="Could not extract meaningful keywords from the job description.",
        )

    matched = jd_keywords & resume_keywords
    missing = jd_keywords - resume_keywords

    overlap_ratio = len(matched) / len(jd_keywords) if jd_keywords else 0
    # Scale to 0-100 with a slight curve (reward covering 70%+ heavily)
    raw_score = min(100, int(overlap_ratio * 120))
    score = max(0, min(100, raw_score))

    matched_list = sorted(matched)[:20]  # Cap for display
    missing_list = sorted(missing)[:15]

    if score >= 80:
        rationale = f"Strong alignment. {len(matched)}/{len(jd_keywords)} JD keywords found in resume."
    elif score >= 50:
        rationale = f"Moderate alignment. {len(matched)}/{len(jd_keywords)} JD keywords found. Consider adding: {', '.join(missing_list[:5])}."
    else:
        rationale = f"Weak alignment. Only {len(matched)}/{len(jd_keywords)} JD keywords found. Key gaps: {', '.join(missing_list[:5])}."

    return ScoreResult(
        score=score,
        matched_keywords=matched_list,
        missing_keywords=missing_list,
        rationale=rationale,
    )
