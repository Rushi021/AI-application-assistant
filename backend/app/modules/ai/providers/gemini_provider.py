"""Gemini LLM adapter using Google AI Studio API (API key)."""

from __future__ import annotations

from app.common.ports import LLMProvider
from app.core.config import get_settings


class GeminiProvider(LLMProvider):
    """LLM provider using Google Gemini via Google AI Studio API key."""

    def __init__(self) -> None:
        settings = get_settings()
        self._api_key = settings.google_ai_api_key
        self._model_name = settings.gemini_model

    def generate(self, prompt: str, **kwargs: object) -> str:
        import google.generativeai as genai

        genai.configure(api_key=self._api_key)
        model = genai.GenerativeModel(self._model_name)
        response = model.generate_content(prompt, **kwargs)
        text = getattr(response, "text", None)
        return (text or "").strip()
