"""Fake LLM for tests and offline runs. Deterministic, no network."""

from __future__ import annotations

import json
import re
from typing import Optional

from app.modules.ai.ports import LLMProvider, LLMResponse, ModelCapabilities
from app.modules.ai.registry import register_llm


def _extract_block(prompt: str, header: str) -> str:
    pattern = re.compile(rf"{re.escape(header)}\s*:?\s*\n---\n(.*?)\n---", re.DOTALL | re.IGNORECASE)
    match = pattern.search(prompt)
    return match.group(1).strip() if match else ""


def _heuristic_requirements(prompt: str) -> dict:
    jd = _extract_block(prompt, "Job description") or prompt
    must: list[str] = []
    nice: list[str] = []
    for line in jd.splitlines():
        lower = line.lower()
        items = re.split(r"[,;•]|\band\b", line)
        cleaned = [re.sub(r"^[\-\*\d\.\)\s]+", "", item).strip() for item in items]
        cleaned = [c for c in cleaned if 1 < len(c) < 80]
        if any(k in lower for k in ("nice to have", "preferred", "plus", "bonus")):
            nice.extend(cleaned)
        elif any(k in lower for k in ("must", "required", "requirement", "qualifications")):
            must.extend(cleaned)
    if not must and not nice:
        # Fall back to a few obvious skill tokens so tests still get a list.
        for token in ("Python", "SQL", "Kubernetes", "machine learning", "computer vision"):
            if re.search(rf"\b{re.escape(token)}\b", jd, re.IGNORECASE):
                must.append(token)
    if not must:
        must = ["communication"]
    def pack(items: list[str], kind: str) -> list[dict]:
        seen: set[str] = set()
        out = []
        for item in items:
            key = item.lower()
            if key in seen or key in {"required", "requirements", "qualifications", "nice to have"}:
                continue
            seen.add(key)
            out.append({"text": item, "kind": kind, "category": "skill", "weight": 1.0})
        return out
    return {"requirements": pack(must, "must_have") + pack(nice, "nice_to_have")}


@register_llm("fake")
class FakeLLMProvider(LLMProvider):
    provider_name = "fake"

    def __init__(self, model: str = "fake") -> None:
        self._model = model or "fake"

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            supports_json_mode=True,
            supports_system_prompt=True,
            max_input_tokens=32_000,
        )

    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        lower = prompt.lower()
        if json_mode or "matching this schema" in lower or "must_have" in lower:
            text = json.dumps(_heuristic_requirements(prompt))
        elif "cover letter" in lower:
            text = (
                "Dear Hiring Manager,\n\n"
                "I am writing to apply for this role. My experience aligns with the listed requirements.\n\n"
                "Sincerely,\nCandidate"
            )
        elif "rewrite" in lower or "bullet" in lower:
            source = prompt.strip().splitlines()[-1]
            text = f"Delivered impact by {source.lstrip('- ').lstrip()}"
        else:
            resume = _extract_block(prompt, "Original resume") or "Resume content"
            text = f"Tailored resume\n\n{resume}\n\nAdded emphasis on the job's must-have skills."
        return LLMResponse(text=text, provider=self.provider_name, model=self._model)
