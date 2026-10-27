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

    def _credential(self) -> str:
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        return self._api_key

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
        client = OpenAI(
            api_key=self._credential(),
            base_url="https://api.openai.com/v1",
            timeout=get_settings().model_timeout_seconds,
            max_retries=0,
        )
        extra: dict = {}
        if system:
            extra["instructions"] = system
        if json_mode:
            extra["text"] = {"format": {"type": "json_object"}}
        completed = None
        text_deltas: list[str] = []
        with client, client.responses.create(
            model=self._model,
            input=[{"role": "user", "content": prompt}],
            store=False,
            stream=True,
            **extra,
        ) as stream:
            for event in stream:
                if event.type == "response.output_text.delta":
                    text_deltas.append(event.delta)
                elif event.type == "response.completed":
                    completed = event.response
                elif event.type in {"response.failed", "response.incomplete", "error"}:
                    response = getattr(event, "response", None)
                    error = getattr(response, "error", None)
                    code = getattr(error, "code", None) or getattr(event, "code", None)
                    raise RuntimeError(f"OpenAI {event.type}: {code or 'generation did not complete'}")
        if completed is None:
            raise RuntimeError("OpenAI stream ended without response.completed")
        # The ChatGPT route may omit output items from the terminal event.
        # Deltas are usable only after response.completed, never on interruption.
        output_text = (completed.output_text or "".join(text_deltas)).strip()
        if not output_text:
            raise RuntimeError("OpenAI returned no text (the request may have been refused)")
        usage = completed.usage
        return LLMResponse(
            text=output_text,
            provider=self.provider_name,
            model=self._model,
            input_tokens=getattr(usage, "input_tokens", None) if usage else None,
            output_tokens=getattr(usage, "output_tokens", None) if usage else None,
        )


@register_llm("chatgpt")
class ChatGPTLLMProvider(OpenAILLMProvider):
    """Responses API using explicitly authorized ChatGPT plan usage, never API billing."""

    provider_name = "chatgpt"

    def _credential(self) -> str:
        from app.modules.ai.chatgpt_auth import access_token

        return access_token()
