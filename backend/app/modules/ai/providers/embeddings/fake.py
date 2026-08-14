"""Deterministic bag-of-words embeddings for tests. No network, no torch."""

from __future__ import annotations

import hashlib
import math
import re
from typing import Sequence

from app.modules.ai.ports import EmbeddingProvider, EmbeddingResult, ModelCapabilities
from app.modules.ai.registry import register_embedding

_DIM = 64
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _vector(text: str, dim: int = _DIM) -> list[float]:
    vec = [0.0] * dim
    for token in _TOKEN_RE.findall(text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:2], "big") % dim
        sign = 1.0 if digest[2] % 2 == 0 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


@register_embedding("fake")
class FakeEmbeddingProvider(EmbeddingProvider):
    provider_name = "fake"

    def __init__(self, model: str = "fake") -> None:
        self._model = model or "fake"
        self._calls: list[tuple[str, ...]] = []

    @property
    def model_name(self) -> str:
        return self._model

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(dimensions=_DIM, max_input_tokens=8_192)

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        self._calls.append(tuple(texts))
        vectors = [_vector(text) for text in texts]
        return EmbeddingResult(
            vectors=vectors,
            provider=self.provider_name,
            model=self._model,
            dimensions=_DIM,
        )
