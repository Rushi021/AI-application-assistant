"""Pipeline orchestration: parallel LLM calls for tailor + cover letter."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Sequence, Tuple

from app.modules.ai.gateway import ModelGateway
from app.modules.ai.prompts.pipeline import (
    build_cover_letter_prompt,
    build_tailor_items_prompt,
    build_tailor_resume_prompt,
)
from app.modules.ai.schemas import TailoredLines


def run_line_tailor_and_cover_letter(
    job_description: str,
    items: Sequence[dict],
    resume_text: str,
    gateway: ModelGateway,
    *,
    frozen_context: str = "",
    instructions: str = "",
    max_workers: int = 2,
) -> Tuple[dict[int, str], str]:
    """Tailor addressable resume lines and write a cover letter, in parallel.

    Returns `({item id: rewritten text}, cover_letter)`. Ids the model invented, or
    edits that come back empty or unchanged, are dropped here so callers only see
    edits they can actually apply.
    """
    offered = {int(item["id"]): str(item["text"]) for item in items}
    cover_letter_prompt = build_cover_letter_prompt(job_description, resume_text)

    def do_tailor() -> dict[int, str]:
        if not offered:
            return {}
        prompt = build_tailor_items_prompt(
            job_description,
            items,
            frozen_context=frozen_context,
            instructions=instructions,
        )
        parsed = gateway.generate_json("resume_tailor", prompt, TailoredLines)
        edits: dict[int, str] = {}
        for line in parsed.items:
            text = (line.text or "").strip()
            if line.id not in offered or not text or text == offered[line.id].strip():
                continue
            edits[line.id] = text
        return edits

    def do_cover_letter() -> str:
        return gateway.generate("cover_letter", cover_letter_prompt).text

    edits: dict[int, str] = {}
    cover_letter: Optional[str] = None
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_tailor = executor.submit(do_tailor)
        future_cover = executor.submit(do_cover_letter)
        for future in as_completed([future_tailor, future_cover]):
            if future is future_tailor:
                edits = future.result()
            else:
                cover_letter = future.result()

    return edits, (cover_letter or "")


def run_tailor_and_cover_letter(
    job_description: str,
    resume_text: str,
    gateway: ModelGateway,
    *,
    instructions: str = "",
    max_workers: int = 2,
) -> Tuple[str, str]:
    """Whole-document tailoring. Returns (tailored_resume_text, cover_letter_text).

    Kept for callers that want prose rather than layout-preserving edits; the
    tailoring module uses `run_line_tailor_and_cover_letter` instead, because a
    single blob cannot be written back into a formatted document.
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
