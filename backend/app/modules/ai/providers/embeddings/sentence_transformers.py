"""Local semantic embeddings. Models are shared across request/task adapters."""

from __future__ import annotations

from typing import Sequence
from functools import lru_cache
from threading import Lock

from app.modules.ai.ports import EmbeddingProvider, EmbeddingResult, ModelCapabilities
from app.modules.ai.registry import register_embedding

_DEFAULT_DIM = 384
_MODEL_LOCK = Lock()


@lru_cache(maxsize=2)
def _load_model(name: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(name, device="cpu")


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
        return ModelCapabilities(dimensions=_DEFAULT_DIM, max_input_tokens=256)

    def _load(self):
        if self._loaded is None:
            with _MODEL_LOCK:
                try:
                    self._loaded = _load_model(self._model)
                except ImportError as exc:
                    raise RuntimeError(
                        "Local embeddings require sentence-transformers. "
                        "Install backend/requirements.txt."
                    ) from exc
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
