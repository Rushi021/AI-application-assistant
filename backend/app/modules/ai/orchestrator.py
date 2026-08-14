"""Pipeline orchestration: parallel LLM calls for tailor + cover letter."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple

from app.modules.ai.gateway import ModelGateway
from app.modules.ai.prompts.pipeline import (
    build_cover_letter_prompt,
    build_tailor_resume_prompt,
)


def run_tailor_and_cover_letter(
    job_description: str,
    resume_text: str,
    gateway: ModelGateway,
    *,
    instructions: str = "",
    max_workers: int = 2,
) -> Tuple[str, str]:
    """
    Run resume tailoring and cover letter generation in parallel via the gateway.
    Returns (tailored_resume_text, cover_letter_text).
    """
    tailor_prompt = build_tailor_resume_prompt(job_description, resume_text, instructions)
    cover_letter_prompt = build_cover_letter_prompt(job_description, resume_text)

    tailored_resume: Optional[str] = None
    cover_letter: Optional[str] = None

    def do_tailor() -> str:
        return gateway.generate("resume_tailor", tailor_prompt).text

    def do_cover_letter() -> str:
        return gateway.generate("cover_letter", cover_letter_prompt).text

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_tailor = executor.submit(do_tailor)
        future_cover = executor.submit(do_cover_letter)
        for future in as_completed([future_tailor, future_cover]):
            result = future.result()
            if future is future_tailor:
                tailored_resume = result
            else:
                cover_letter = result

    return (tailored_resume or "", cover_letter or "")
