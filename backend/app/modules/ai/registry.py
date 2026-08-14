"""Decorator-based provider registry.

Adding a provider is one adapter file plus `@register_llm("name")` / `@register_embedding("name")`.
No edits to deps.py or config.py are required.
"""

from __future__ import annotations

from typing import Callable, TypeVar

from app.modules.ai.ports import EmbeddingProvider, LLMProvider

LLMFactory = Callable[[str], LLMProvider]
EmbeddingFactory = Callable[[str], EmbeddingProvider]

_LLM_FACTORIES: dict[str, LLMFactory] = {}
_EMBEDDING_FACTORIES: dict[str, EmbeddingFactory] = {}

L = TypeVar("L", bound=type)
E = TypeVar("E", bound=type)


class UnknownProviderError(KeyError):
    pass


def register_llm(name: str) -> Callable[[L], L]:
    def decorator(cls: L) -> L:
        def factory(model: str) -> LLMProvider:
            return cls(model)  # type: ignore[misc]

        _LLM_FACTORIES[name.lower()] = factory
        return cls

    return decorator


def register_embedding(name: str) -> Callable[[E], E]:
    def decorator(cls: E) -> E:
        def factory(model: str) -> EmbeddingProvider:
            return cls(model)  # type: ignore[misc]

        _EMBEDDING_FACTORIES[name.lower()] = factory
        return cls

    return decorator


def create_llm(provider: str, model: str) -> LLMProvider:
    key = provider.lower()
    factory = _LLM_FACTORIES.get(key)
    if factory is None:
        known = ", ".join(sorted(_LLM_FACTORIES)) or "(none registered)"
        raise UnknownProviderError(f"Unknown LLM provider {provider!r}. Registered: {known}")
    return factory(model)


def create_embedding(provider: str, model: str) -> EmbeddingProvider:
    key = provider.lower()
    factory = _EMBEDDING_FACTORIES.get(key)
    if factory is None:
        known = ", ".join(sorted(_EMBEDDING_FACTORIES)) or "(none registered)"
        raise UnknownProviderError(f"Unknown embedding provider {provider!r}. Registered: {known}")
    return factory(model)


def list_llm_providers() -> list[str]:
    return sorted(_LLM_FACTORIES)


def list_embedding_providers() -> list[str]:
    return sorted(_EMBEDDING_FACTORIES)
