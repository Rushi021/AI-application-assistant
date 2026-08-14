"""Ollama LLM adapter. Uses stdlib urllib — no extra dependency."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Optional

from app.core.config import get_settings
from app.modules.ai.ports import LLMProvider, LLMResponse, ModelCapabilities
from app.modules.ai.registry import register_llm


@register_llm("ollama")
class OllamaLLMProvider(LLMProvider):
    provider_name = "ollama"

    def __init__(self, model: str) -> None:
        self._model = model
        self._base = get_settings().ollama_base_url.rstrip("/")

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
        payload: dict = {
            "model": self._model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system
        if json_mode:
            payload["format"] = "json"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self._base}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=get_settings().model_timeout_seconds) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Ollama request failed ({self._base}): {exc}") from exc
        return LLMResponse(
            text=(body.get("response") or "").strip(),
            provider=self.provider_name,
            model=self._model,
        )
