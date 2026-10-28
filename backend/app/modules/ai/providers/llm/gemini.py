"""Gemini REST adapter: per-request credentials, bounded network timeouts.

Avoids the retired globally configured SDK, including cross-thread configure races
when resume tailoring and cover-letter generation run concurrently.
"""

from typing import Optional
import httpx
from app.core.config import get_settings
from app.modules.ai.ports import LLMProvider, LLMResponse, ModelCapabilities
from app.modules.ai.registry import register_llm


@register_llm("gemini")
class GeminiLLMProvider(LLMProvider):
    provider_name = "gemini"

    def __init__(self, model: str):
        self._model = model.removeprefix("models/")
        self._api_key = get_settings().google_ai_api_key

    @property
    def model_name(self):
        return self._model

    def capabilities(self):
        return ModelCapabilities(
            supports_json_mode=True,
            supports_system_prompt=True,
            max_input_tokens=32_000,
        )

    def generate(
        self, prompt: str, *, system: Optional[str] = None, json_mode=False, **kwargs
    ):
        if not self._api_key or self._api_key.startswith(("placeholder", "your-")):
            raise ValueError("Configure GOOGLE_AI_API_KEY for Gemini")
        body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if json_mode:
            body["generationConfig"] = {"responseMimeType": "application/json"}
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent",
            headers={"x-goog-api-key": self._api_key},
            json=body,
            timeout=get_settings().model_timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates", [])
        text = (
            "".join(
                p.get("text", "")
                for p in candidates[0].get("content", {}).get("parts", [])
                if not p.get("thought")
            )
            if candidates
            else ""
        )
        if not text.strip():
            raise ValueError("Gemini returned no usable content")
        usage = data.get("usageMetadata", {})
        return LLMResponse(
            text=text.strip(),
            provider=self.provider_name,
            model=self._model,
            input_tokens=usage.get("promptTokenCount"),
            output_tokens=usage.get("candidatesTokenCount"),
        )
