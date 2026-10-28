"""Gemini embeddings via REST. Dimensions remain part of the cache namespace."""

from typing import Sequence
import httpx
from app.core.config import get_settings
from app.modules.ai.ports import EmbeddingProvider, EmbeddingResult, ModelCapabilities
from app.modules.ai.registry import register_embedding


@register_embedding("gemini")
class GeminiEmbeddingProvider(EmbeddingProvider):
    provider_name = "gemini"

    def __init__(self, model: str):
        self._model = model.removeprefix("models/")
        self._api_key = get_settings().google_ai_api_key

    @property
    def model_name(self):
        return self._model

    def capabilities(self):
        return ModelCapabilities(dimensions=768, max_input_tokens=2_048)

    def embed(self, texts: Sequence[str]):
        if not self._api_key or self._api_key.startswith(("placeholder", "your-")):
            raise ValueError("Configure GOOGLE_AI_API_KEY for Gemini")
        vectors = []
        for offset in range(0, len(texts), 50):
            requests = [
                {
                    "model": f"models/{self._model}",
                    "content": {"parts": [{"text": t}]},
                    "taskType": "SEMANTIC_SIMILARITY",
                    "outputDimensionality": 768,
                }
                for t in texts[offset : offset + 50]
            ]
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:batchEmbedContents",
                headers={"x-goog-api-key": self._api_key},
                json={"requests": requests},
                timeout=get_settings().model_timeout_seconds,
            )
            response.raise_for_status()
            values = [e["values"] for e in response.json()["embeddings"]]
            if len(values) != len(requests) or any(len(v) != 768 for v in values):
                raise ValueError("Unexpected embedding dimensions or count")
            vectors.extend(values)
        return EmbeddingResult(
            vectors=vectors,
            provider=self.provider_name,
            model=self._model,
            dimensions=768,
        )
