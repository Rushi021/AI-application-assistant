"""Provider-agnostic ports for LLMs and embeddings.

Nothing outside `app.modules.ai` should import a concrete provider class
or hardcode a model name. Callers go through ModelGateway.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Sequence


@dataclass(frozen=True)
class ModelCapabilities:
    supports_json_mode: bool = False
    supports_system_prompt: bool = False
    max_input_tokens: int = 8192
    dimensions: Optional[int] = None


@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None


@dataclass
class EmbeddingResult:
    vectors: list[list[float]]
    provider: str
    model: str
    dimensions: int
    namespace: str = ""

    def __post_init__(self) -> None:
        if not self.namespace:
            self.namespace = f"{self.provider}:{self.model}:{self.dimensions}"


class LLMProvider(ABC):
    """Port for text generation. Adapters implement this; callers never import adapters."""

    provider_name: str = "unknown"

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        raise NotImplementedError

    @abstractmethod
    def capabilities(self) -> ModelCapabilities:
        raise NotImplementedError

    @property
    @abstractmethod
    def model_name(self) -> str:
        raise NotImplementedError


class EmbeddingProvider(ABC):
    """Port for vector embeddings. Vectors are namespaced by provider:model:dimensions."""

    provider_name: str = "unknown"

    @abstractmethod
    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        raise NotImplementedError

    @abstractmethod
    def capabilities(self) -> ModelCapabilities:
        raise NotImplementedError

    @property
    @abstractmethod
    def model_name(self) -> str:
        raise NotImplementedError

    @property
    def dimensions(self) -> int:
        caps = self.capabilities()
        return caps.dimensions or 0

    @property
    def namespace(self) -> str:
        return f"{self.provider_name}:{self.model_name}:{self.dimensions}"


@dataclass
class ModelCallRecord:
    task: str
    provider: str
    model: str
    latency_ms: float
    success: bool
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    error: Optional[str] = None
    extra: dict = field(default_factory=dict)


class UsageLogger(ABC):
    @abstractmethod
    def record(self, call: ModelCallRecord) -> None:
        raise NotImplementedError


class NullUsageLogger(UsageLogger):
    def record(self, call: ModelCallRecord) -> None:
        return None
