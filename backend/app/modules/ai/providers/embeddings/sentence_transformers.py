"""Local sentence-transformers adapter. Optional extra (torch); imported lazily."""

from __future__ import annotations

from typing import Sequence

from app.modules.ai.ports import EmbeddingProvider, EmbeddingResult, ModelCapabilities
from app.modules.ai.registry import register_embedding

_DEFAULT_DIM = 384


@register_embedding("sentence_transformers")
@register_embedding("sbert")
class SentenceTransformersEmbeddingProvider(EmbeddingProvider):
    provider_name = "sentence_transformers"

    def __init__(self, model: str) -> None:
        self._model = model
        self._loaded = None

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(dimensions=_DEFAULT_DIM, max_input_tokens=512)

    def _load(self):
        if self._loaded is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise RuntimeError(
                    "sentence-transformers extra is not installed. "
                    "pip install sentence-transformers"
                ) from exc
            self._loaded = SentenceTransformer(self._model)
        return self._loaded

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        model = self._load()
        matrix = model.encode(list(texts), normalize_embeddings=True)
        vectors = [row.tolist() for row in matrix]
        dim = len(vectors[0]) if vectors else _DEFAULT_DIM
        return EmbeddingResult(
            vectors=vectors,
            provider=self.provider_name,
            model=self._model,
            dimensions=dim,
        )
