"""Gemini embeddings (`text-embedding-004` by default). Lazy SDK import."""

from __future__ import annotations

from typing import Sequence

from app.core.config import get_settings
from app.modules.ai.ports import EmbeddingProvider, EmbeddingResult, ModelCapabilities
from app.modules.ai.registry import register_embedding

_DEFAULT_DIM = 768


@register_embedding("gemini")
class GeminiEmbeddingProvider(EmbeddingProvider):
    provider_name = "gemini"

    def __init__(self, model: str) -> None:
        self._model = model
        self._api_key = get_settings().google_ai_api_key

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(dimensions=_DEFAULT_DIM, max_input_tokens=2_048)

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        import google.generativeai as genai

        genai.configure(api_key=self._api_key)
        model_name = self._model if self._model.startswith("models/") else f"models/{self._model}"
        vectors: list[list[float]] = []
        for text in texts:
            result = genai.embed_content(model=model_name, content=text, task_type="retrieval_document")
            embedding = result["embedding"] if isinstance(result, dict) else result.embedding
            vectors.append(list(embedding))
        dim = len(vectors[0]) if vectors else _DEFAULT_DIM
        return EmbeddingResult(
            vectors=vectors,
            provider=self.provider_name,
            model=self._model,
            dimensions=dim,
        )
