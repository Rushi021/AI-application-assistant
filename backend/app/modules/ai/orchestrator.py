"""Pipeline orchestration: parallel LLM calls for tailor + cover letter."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from typing import List, Optional, Tuple

from app.common.docx_service import parse_sectioned_tailored_output
from app.common.ports import LLMProvider
from app.modules.ai.prompts.pipeline import (
    build_cover_letter_prompt,
    build_tailor_resume_prompt,
    build_tailor_resume_sectioned_prompt,
)


def run_tailor_and_cover_letter(
    job_description: str,
    resume_text: str,
    llm: LLMProvider,
    *,
    tailor_instructions: Optional[str] = None,
    cover_letter_instructions: Optional[str] = None,
    sectioned_resume_text: Optional[str] = None,
    num_paragraphs: Optional[int] = None,
    max_workers: int = 2,
) -> Tuple[str, Optional[str], str]:
    """
    Run resume tailoring and cover letter generation in parallel.
    Returns (tailored_resume_text, tailored_sections_json_or_none, cover_letter_text).
    When sectioned_resume_text and num_paragraphs are set, uses sectioned prompt and
    returns tailored_sections as JSON string; otherwise tailored_sections is None.
    """
    if sectioned_resume_text is not None and num_paragraphs is not None and num_paragraphs > 0:
        tailor_prompt = build_tailor_resume_sectioned_prompt(
            job_description, sectioned_resume_text, num_paragraphs, tailor_instructions
        )
    else:
        tailor_prompt = build_tailor_resume_prompt(
            job_description, resume_text, tailor_instructions
        )
    cover_letter_prompt = build_cover_letter_prompt(
        job_description, resume_text, cover_letter_instructions
    )

    tailored_resume: Optional[str] = None
    cover_letter: Optional[str] = None

    def do_tailor() -> str:
        return llm.generate(tailor_prompt)

    def do_cover_letter() -> str:
        return llm.generate(cover_letter_prompt)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_tailor = executor.submit(do_tailor)
        future_cover = executor.submit(do_cover_letter)
        for future in as_completed([future_tailor, future_cover]):
            result = future.result()
            if future is future_tailor:
                tailored_resume = result
            else:
                cover_letter = result

    tailored_sections_json: Optional[str] = None
    if tailored_resume and num_paragraphs is not None and num_paragraphs > 0:
        sections: List[str] = parse_sectioned_tailored_output(
            tailored_resume, num_paragraphs
        )
        tailored_sections_json = json.dumps(sections)

    return (tailored_resume or "", tailored_sections_json, cover_letter or "")
