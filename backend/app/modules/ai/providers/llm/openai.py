"""OpenAI LLM adapter. `openai` is an optional extra; imported lazily."""

from __future__ import annotations

from typing import Optional

from app.core.config import get_settings
from app.modules.ai.ports import LLMProvider, LLMResponse, ModelCapabilities
from app.modules.ai.registry import register_llm


@register_llm("openai")
class OpenAILLMProvider(LLMProvider):
    provider_name = "openai"

    def __init__(self, model: str) -> None:
        self._model = model
        self._api_key = get_settings().openai_api_key

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            supports_json_mode=True,
            supports_system_prompt=True,
            max_input_tokens=128_000,
        )

    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "openai extra is not installed. pip install openai  (optional extra)"
            ) from exc
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        client = OpenAI(api_key=self._api_key)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        extra: dict = {}
        if json_mode:
            extra["response_format"] = {"type": "json_object"}
        completion = client.chat.completions.create(
            model=self._model,
            messages=messages,
            **extra,
        )
        choice = completion.choices[0]
        usage = completion.usage
        return LLMResponse(
            text=(choice.message.content or "").strip(),
            provider=self.provider_name,
            model=self._model,
            input_tokens=getattr(usage, "prompt_tokens", None) if usage else None,
            output_tokens=getattr(usage, "completion_tokens", None) if usage else None,
        )
