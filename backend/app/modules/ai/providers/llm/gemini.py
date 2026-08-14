"""Gemini LLM adapter. SDK is imported lazily so startup never requires a key."""

from __future__ import annotations

from typing import Optional

from app.core.config import get_settings
from app.modules.ai.ports import LLMProvider, LLMResponse, ModelCapabilities
from app.modules.ai.registry import register_llm


@register_llm("gemini")
class GeminiLLMProvider(LLMProvider):
    provider_name = "gemini"

    def __init__(self, model: str) -> None:
        self._model = model
        self._api_key = get_settings().google_ai_api_key

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            supports_json_mode=True,
            supports_system_prompt=True,
            max_input_tokens=1_000_000 if "pro" in self._model or "1.5" in self._model else 32_000,
        )

    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        import google.generativeai as genai

        genai.configure(api_key=self._api_key)
        generation_config: dict = {}
        if json_mode:
            generation_config["response_mime_type"] = "application/json"
        system_instruction = system if system else None
        model = genai.GenerativeModel(
            self._model,
            system_instruction=system_instruction,
            generation_config=generation_config or None,
        )
        response = model.generate_content(prompt)
        text = (getattr(response, "text", None) or "").strip()
        input_tokens = output_tokens = None
        usage = getattr(response, "usage_metadata", None)
        if usage is not None:
            input_tokens = getattr(usage, "prompt_token_count", None)
            output_tokens = getattr(usage, "candidates_token_count", None)
        return LLMResponse(
            text=text,
            provider=self.provider_name,
            model=self._model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
