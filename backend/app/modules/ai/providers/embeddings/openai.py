"""OpenAI embeddings adapter. Optional extra; imported lazily."""

from __future__ import annotations

from typing import Sequence

from app.core.config import get_settings
from app.modules.ai.ports import EmbeddingProvider, EmbeddingResult, ModelCapabilities
from app.modules.ai.registry import register_embedding

_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


@register_embedding("openai")
class OpenAIEmbeddingProvider(EmbeddingProvider):
    provider_name = "openai"

    def __init__(self, model: str) -> None:
        self._model = model
        self._api_key = get_settings().openai_api_key

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(dimensions=_DIMS.get(self._model, 1536), max_input_tokens=8_191)

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError("openai extra is not installed. pip install openai") from exc
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        client = OpenAI(api_key=self._api_key)
        response = client.embeddings.create(model=self._model, input=list(texts))
        ordered = sorted(response.data, key=lambda item: item.index)
        vectors = [list(item.embedding) for item in ordered]
        dim = len(vectors[0]) if vectors else self.capabilities().dimensions or 1536
        return EmbeddingResult(
            vectors=vectors,
            provider=self.provider_name,
            model=self._model,
            dimensions=dim,
        )
