"""Gemini LLM adapter using Google AI Studio API (API key)."""

from __future__ import annotations

import logging

from app.common.ports import LLMProvider
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PLACEHOLDER_KEYS = frozenset(
    {
        "",
        "placeholder-api-key-replace-with-real",
        "your-api-key",
    }
)


def _extract_response_text(response: object) -> str:
    """
    Collect text from candidates without using ``response.text`` first — that
    accessor raises ValueError when the response is blocked, has no parts, or is
    not a simple single-part reply (common for resume/job prompts).
    """
    candidates = getattr(response, "candidates", None) or []
    parts: list[str] = []
    for cand in candidates:
        content = getattr(cand, "content", None)
        if content is None:
            continue
        for part in getattr(content, "parts", None) or []:
            t = getattr(part, "text", None)
            if t:
                parts.append(t)
    if parts:
        return "".join(parts)

    try:
        t = getattr(response, "text", None)
        if isinstance(t, str) and t.strip():
            return t
    except (ValueError, AttributeError):
        pass
    return ""


def _describe_block_or_empty(response: object) -> str:
    pb = getattr(response, "prompt_feedback", None)
    if pb is not None:
        br = getattr(pb, "block_reason", None)
        if br is not None and str(br) not in ("0", "BlockReason.BLOCK_REASON_UNSPECIFIED", ""):
            return f"Prompt blocked: {br}."
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return "No candidates in response."
    c0 = candidates[0]
    fr = getattr(c0, "finish_reason", None)
    if fr is not None:
        return f"Finish reason: {fr}."
    return "No text parts in response."


class GeminiProvider(LLMProvider):
    """LLM provider using Google Gemini via Google AI Studio API key."""

    def __init__(self) -> None:
        settings = get_settings()
        self._api_key = (settings.google_ai_api_key or "").strip()
        self._model_name = settings.gemini_model

    def generate(self, prompt: str, **kwargs: object) -> str:
        import google.generativeai as genai
        from google.generativeai.types import HarmBlockThreshold, HarmCategory

        if not self._api_key or self._api_key in _PLACEHOLDER_KEYS:
            raise RuntimeError(
                "GOOGLE_AI_API_KEY is missing or still set to the placeholder. "
                "Set a valid Google AI Studio API key in the environment or .env file."
            )

        gen_kwargs: dict[str, object] = dict(kwargs)
        if "safety_settings" not in gen_kwargs:
            # Job descriptions and resumes often trip default filters; keep only high-confidence blocks.
            gen_kwargs["safety_settings"] = {
                HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_ONLY_HIGH,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
            }

        genai.configure(api_key=self._api_key)
        model = genai.GenerativeModel(self._model_name)
        try:
            response = model.generate_content(prompt, **gen_kwargs)
        except Exception as e:
            logger.exception("Gemini generate_content failed model=%s", self._model_name)
            raise RuntimeError(f"Gemini request failed: {e}") from e

        text = _extract_response_text(response)
        if text.strip():
            return text.strip()

        block_hint = _describe_block_or_empty(response)
        logger.warning("Gemini returned empty text model=%s: %s", self._model_name, block_hint)
        raise RuntimeError(
            "The model returned no usable text (often due to safety filters or an empty candidate). "
            f"{block_hint}"
        )
