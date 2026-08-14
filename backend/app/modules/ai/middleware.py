"""Composable wrappers applied once around whichever adapter config selected."""

from __future__ import annotations

import logging
import time
from typing import Optional, Sequence

from app.modules.ai.ports import (
    EmbeddingProvider,
    EmbeddingResult,
    LLMProvider,
    LLMResponse,
    ModelCallRecord,
    ModelCapabilities,
    UsageLogger,
)

logger = logging.getLogger(__name__)

_TRANSIENT_MARKERS = (
    "429",
    "500",
    "502",
    "503",
    "504",
    "timeout",
    "temporarily",
    "unavailable",
    "rate limit",
    "overloaded",
    "connection reset",
)


def _is_transient(exc: BaseException) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _TRANSIENT_MARKERS)


class RetryingLLM(LLMProvider):
    def __init__(self, inner: LLMProvider, *, max_retries: int = 2, backoff_seconds: float = 0.4) -> None:
        self._inner = inner
        self._max_retries = max_retries
        self._backoff = backoff_seconds
        self.provider_name = inner.provider_name

    @property
    def model_name(self) -> str:
        return self._inner.model_name

    def capabilities(self) -> ModelCapabilities:
        return self._inner.capabilities()

    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        last: BaseException | None = None
        attempts = self._max_retries + 1
        for attempt in range(attempts):
            try:
                return self._inner.generate(prompt, system=system, json_mode=json_mode, **kwargs)
            except Exception as exc:  # noqa: BLE001 - adapters raise SDK-specific types
                last = exc
                if attempt >= self._max_retries or not _is_transient(exc):
                    raise
                delay = self._backoff * (2**attempt)
                logger.warning(
                    "LLM %s:%s attempt %s failed (%s); retrying in %.2fs",
                    self.provider_name,
                    self.model_name,
                    attempt + 1,
                    exc,
                    delay,
                )
                time.sleep(delay)
        raise last or RuntimeError("retry exhausted")


class RetryingEmbedding(EmbeddingProvider):
    def __init__(self, inner: EmbeddingProvider, *, max_retries: int = 2, backoff_seconds: float = 0.4) -> None:
        self._inner = inner
        self._max_retries = max_retries
        self._backoff = backoff_seconds
        self.provider_name = inner.provider_name

    @property
    def model_name(self) -> str:
        return self._inner.model_name

    def capabilities(self) -> ModelCapabilities:
        return self._inner.capabilities()

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        last: BaseException | None = None
        attempts = self._max_retries + 1
        for attempt in range(attempts):
            try:
                return self._inner.embed(texts)
            except Exception as exc:  # noqa: BLE001
                last = exc
                if attempt >= self._max_retries or not _is_transient(exc):
                    raise
                delay = self._backoff * (2**attempt)
                logger.warning(
                    "Embedding %s:%s attempt %s failed (%s); retrying in %.2fs",
                    self.provider_name,
                    self.model_name,
                    attempt + 1,
                    exc,
                    delay,
                )
                time.sleep(delay)
        raise last or RuntimeError("retry exhausted")


class LoggingLLM(LLMProvider):
    def __init__(self, inner: LLMProvider, *, task: str, usage: UsageLogger) -> None:
        self._inner = inner
        self._task = task
        self._usage = usage
        self.provider_name = inner.provider_name

    @property
    def model_name(self) -> str:
        return self._inner.model_name

    def capabilities(self) -> ModelCapabilities:
        return self._inner.capabilities()

    def generate(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        started = time.perf_counter()
        try:
            response = self._inner.generate(prompt, system=system, json_mode=json_mode, **kwargs)
        except Exception as exc:  # noqa: BLE001
            self._usage.record(
                ModelCallRecord(
                    task=self._task,
                    provider=self.provider_name,
                    model=self.model_name,
                    latency_ms=(time.perf_counter() - started) * 1000,
                    success=False,
                    error=str(exc)[:500],
                )
            )
            raise
        self._usage.record(
            ModelCallRecord(
                task=self._task,
                provider=response.provider,
                model=response.model,
                latency_ms=(time.perf_counter() - started) * 1000,
                success=True,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
            )
        )
        return response


class LoggingEmbedding(EmbeddingProvider):
    def __init__(self, inner: EmbeddingProvider, *, task: str, usage: UsageLogger) -> None:
        self._inner = inner
        self._task = task
        self._usage = usage
        self.provider_name = inner.provider_name

    @property
    def model_name(self) -> str:
        return self._inner.model_name

    def capabilities(self) -> ModelCapabilities:
        return self._inner.capabilities()

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        started = time.perf_counter()
        try:
            result = self._inner.embed(texts)
        except Exception as exc:  # noqa: BLE001
            self._usage.record(
                ModelCallRecord(
                    task=self._task,
                    provider=self.provider_name,
                    model=self.model_name,
                    latency_ms=(time.perf_counter() - started) * 1000,
                    success=False,
                    error=str(exc)[:500],
                    extra={"n_texts": len(texts)},
                )
            )
            raise
        self._usage.record(
            ModelCallRecord(
                task=self._task,
                provider=result.provider,
                model=result.model,
                latency_ms=(time.perf_counter() - started) * 1000,
                success=True,
                extra={"n_texts": len(texts), "namespace": result.namespace},
            )
        )
        return result


def wrap_llm(inner: LLMProvider, *, task: str, usage: UsageLogger, max_retries: int) -> LLMProvider:
    wrapped: LLMProvider = RetryingLLM(inner, max_retries=max_retries)
    return LoggingLLM(wrapped, task=task, usage=usage)


def wrap_embedding(
    inner: EmbeddingProvider, *, task: str, usage: UsageLogger, max_retries: int
) -> EmbeddingProvider:
    wrapped: EmbeddingProvider = RetryingEmbedding(inner, max_retries=max_retries)
    return LoggingEmbedding(wrapped, task=task, usage=usage)
