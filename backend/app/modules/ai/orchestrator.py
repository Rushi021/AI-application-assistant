"""Pipeline orchestration: tailor resume + cover letter."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from app.common.ports import LLMProvider
from app.common.resume_parser import get_editable_sections, get_full_text
from app.modules.ai.prompts.pipeline import (
    build_cover_letter_prompt,
    build_tailor_resume_json_prompt,
    build_tailor_resume_prompt,
)

logger = logging.getLogger(__name__)


def _parse_llm_json_response(raw: str, expected_ids: List[str]) -> Dict[str, str]:
    """
    Parse the LLM's JSON array response into a {section_id: text} dict.

    Tries strict JSON first, then falls back to regex extraction.
    """
    # Strip markdown code fences if the LLM wrapped the output
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # Remove opening fence (```json or ```)
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        # Remove closing fence
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)

    # Attempt 1: strict JSON parse
    try:
        items = json.loads(cleaned)
        if isinstance(items, list):
            result: Dict[str, str] = {}
            for item in items:
                if isinstance(item, dict) and "id" in item and "text" in item:
                    result[item["id"]] = item["text"]
            if result:
                logger.info("Parsed LLM JSON: %d sections extracted", len(result))
                return result
    except json.JSONDecodeError:
        logger.warning("LLM output is not valid JSON; attempting regex fallback")

    # Attempt 2: regex fallback — extract {"id": "...", "text": "..."} blocks
    pattern = r'"id"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)?"'
    matches = re.findall(pattern, cleaned, re.DOTALL)
    if matches:
        result = {}
        for sid, text in matches:
            # Unescape JSON string escapes
            text = text.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
            result[sid] = text
        logger.info("Regex fallback: extracted %d sections", len(result))
        return result

    # Attempt 3: try to find JSON array anywhere in the text
    json_match = re.search(r'\[.*\]', cleaned, re.DOTALL)
    if json_match:
        try:
            items = json.loads(json_match.group())
            if isinstance(items, list):
                result = {}
                for item in items:
                    if isinstance(item, dict) and "id" in item and "text" in item:
                        result[item["id"]] = item["text"]
                if result:
                    logger.info("Found embedded JSON array: %d sections", len(result))
                    return result
        except json.JSONDecodeError:
            pass

    logger.error("Could not parse LLM tailored output as JSON or via regex")
    return {}


def run_tailor_and_cover_letter(
    job_description: str,
    resume_text: str,
    llm: LLMProvider,
    *,
    tailor_instructions: Optional[str] = None,
    cover_letter_instructions: Optional[str] = None,
    parsed_json: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Optional[str], str]:
    """
    Run resume tailoring and cover letter generation.

    Returns (tailored_resume_text, tailored_sections_json_or_none, cover_letter_text).

    When ``parsed_json`` is provided, uses the section-aware JSON prompt and
    returns tailored_sections as a JSON dict keyed by section_id.
    Otherwise falls back to the plain-text prompt.
    """
    tailored_sections_dict: Optional[Dict[str, str]] = None

    if parsed_json is not None:
        editable = get_editable_sections(parsed_json)
        if editable:
            tailor_prompt = build_tailor_resume_json_prompt(
                job_description, editable, tailor_instructions,
            )
            expected_ids = [sec["id"] for sec in editable]

            logger.info("Sending section-aware tailor prompt (%d editable sections)", len(editable))

            raw_response = llm.generate(tailor_prompt)

            logger.info("LLM raw response (first 2000 chars): %s", (raw_response or "")[:2000])

            if raw_response:
                tailored_sections_dict = _parse_llm_json_response(raw_response, expected_ids)

                # Warn about missing or extra sections
                returned_ids = set(tailored_sections_dict.keys())
                expected_set = set(expected_ids)
                missing = expected_set - returned_ids
                extra = returned_ids - expected_set
                if missing:
                    logger.warning("LLM did not return sections: %s", missing)
                if extra:
                    logger.warning("LLM returned unexpected sections: %s", extra)

    if tailored_sections_dict is None:
        # Fallback: plain-text tailor (no parsed_json or JSON parse failed)
        tailor_prompt = build_tailor_resume_prompt(
            job_description, resume_text, tailor_instructions,
        )
        logger.info("Using plain-text tailor prompt (no parsed_json)")
        raw_response = llm.generate(tailor_prompt)
        tailored_resume_text = raw_response or ""
    else:
        # Build full tailored text from sections dict for cover letter context
        if parsed_json:
            parts = []
            for sec in parsed_json["sections"]:
                if sec["id"] in tailored_sections_dict:
                    parts.append(tailored_sections_dict[sec["id"]])
                else:
                    parts.append(sec.get("content", ""))
            tailored_resume_text = "\n\n".join(parts)
        else:
            tailored_resume_text = resume_text

    # Serialise tailored_sections for storage
    tailored_sections_json: Optional[str] = None
    if tailored_sections_dict:
        tailored_sections_json = json.dumps(tailored_sections_dict)

    # Cover letter generation
    cover_letter_resume = tailored_resume_text if tailored_resume_text else resume_text
    cover_letter_prompt = build_cover_letter_prompt(
        job_description, cover_letter_resume, cover_letter_instructions,
    )
    cover_letter = llm.generate(cover_letter_prompt)

    return (tailored_resume_text or "", tailored_sections_json, cover_letter or "")


def run_tailor_only(
    job_description: str,
    resume_text: str,
    llm: LLMProvider,
    *,
    tailor_instructions: Optional[str] = None,
    parsed_json: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Optional[str]]:
    """
    Run resume tailoring only (no cover letter). Saves one LLM call.

    Returns (tailored_resume_text, tailored_sections_json_or_none).
    """
    tailored_sections_dict: Optional[Dict[str, str]] = None

    if parsed_json is not None:
        editable = get_editable_sections(parsed_json)
        if editable:
            tailor_prompt = build_tailor_resume_json_prompt(
                job_description, editable, tailor_instructions,
            )
            expected_ids = [sec["id"] for sec in editable]
            logger.info("Sending section-aware tailor prompt (%d editable sections)", len(editable))
            raw_response = llm.generate(tailor_prompt)
            logger.info("LLM raw response (first 2000 chars): %s", (raw_response or "")[:2000])
            if raw_response:
                tailored_sections_dict = _parse_llm_json_response(raw_response, expected_ids)
                returned_ids = set(tailored_sections_dict.keys())
                expected_set = set(expected_ids)
                missing = expected_set - returned_ids
                extra = returned_ids - expected_set
                if missing:
                    logger.warning("LLM did not return sections: %s", missing)
                if extra:
                    logger.warning("LLM returned unexpected sections: %s", extra)

    if tailored_sections_dict is None:
        tailor_prompt = build_tailor_resume_prompt(
            job_description, resume_text, tailor_instructions,
        )
        logger.info("Using plain-text tailor prompt (no parsed_json)")
        raw_response = llm.generate(tailor_prompt)
        tailored_resume_text = raw_response or ""
    else:
        if parsed_json:
            parts = []
            for sec in parsed_json["sections"]:
                if sec["id"] in tailored_sections_dict:
                    parts.append(tailored_sections_dict[sec["id"]])
                else:
                    parts.append(sec.get("content", ""))
            tailored_resume_text = "\n\n".join(parts)
        else:
            tailored_resume_text = resume_text

    tailored_sections_json: Optional[str] = None
    if tailored_sections_dict:
        tailored_sections_json = json.dumps(tailored_sections_dict)
    return (tailored_resume_text or "", tailored_sections_json)
