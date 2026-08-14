"""Capability-aware structured (JSON) generation with a self-repair retry."""

from __future__ import annotations

import json
import re
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.modules.ai.ports import LLMProvider, LLMResponse

T = TypeVar("T", bound=BaseModel)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def strip_json_fences(text: str) -> str:
    stripped = text.strip()
    match = _FENCE_RE.search(stripped)
    if match:
        return match.group(1).strip()
    # If the model wrapped JSON in prose, grab the outermost object/array.
    for opener, closer in (("{", "}"), ("[", "]")):
        start = stripped.find(opener)
        end = stripped.rfind(closer)
        if start != -1 and end > start:
            return stripped[start : end + 1]
    return stripped


def parse_model(text: str, schema: type[T]) -> T:
    payload = json.loads(strip_json_fences(text))
    return schema.model_validate(payload)


def generate_json(
    llm: LLMProvider,
    prompt: str,
    schema: type[T],
    *,
    system: str | None = None,
) -> tuple[T, LLMResponse]:
    """Generate JSON matching `schema`.

    Uses native JSON mode when the adapter advertises it; otherwise asks for
    JSON in the prompt and fence-strips. One self-repair retry on parse failure.
    """
    caps = llm.capabilities()
    json_mode = caps.supports_json_mode
    schema_hint = json.dumps(schema.model_json_schema(), indent=2)
    system_text = system or "You output valid JSON only. No markdown, no commentary."
    full_prompt = (
        f"{prompt.rstrip()}\n\n"
        f"Respond with JSON matching this schema:\n{schema_hint}"
    )
    response = llm.generate(full_prompt, system=system_text, json_mode=json_mode)
    try:
        return parse_model(response.text, schema), response
    except (json.JSONDecodeError, ValidationError) as first_error:
        repair_prompt = (
            "The previous response was not valid against the schema.\n"
            f"Error: {first_error}\n\n"
            f"Previous response:\n{response.text[:4000]}\n\n"
            "Return corrected JSON only."
        )
        repaired = llm.generate(repair_prompt, system=system_text, json_mode=json_mode)
        return parse_model(repaired.text, schema), repaired
