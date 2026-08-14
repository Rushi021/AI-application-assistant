"""ModelGateway — the only object application code should call for models.

Callers pass a *task* name. Config maps that task to a `provider:model` spec.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional, Sequence, TypeVar

from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.modules.ai.middleware import wrap_embedding, wrap_llm
from app.modules.ai.ports import (
    EmbeddingProvider,
    EmbeddingResult,
    LLMProvider,
    LLMResponse,
    NullUsageLogger,
    UsageLogger,
)
from app.modules.ai.registry import (
    create_embedding,
    create_llm,
    list_embedding_providers,
    list_llm_providers,
)
from app.modules.ai.specs import ModelSpec, parse_spec
from app.modules.ai.structured import generate_json as _generate_json

T = TypeVar("T", bound=BaseModel)

# task -> (settings field for override, settings field for default)
LLM_TASKS: dict[str, tuple[str, str]] = {
    "jd_extraction": ("llm_jd_extraction", "llm_default"),
    "resume_tailor": ("llm_resume_tailor", "llm_default"),
    "bullet_rewrite": ("llm_bullet_rewrite", "llm_default"),
    "cover_letter": ("llm_cover_letter", "llm_default"),
}

EMBEDDING_TASKS: dict[str, tuple[str, str]] = {
    "requirement_embedding": ("embedding_requirement", "embedding_default"),
    "resume_embedding": ("embedding_resume", "embedding_default"),
}


def _field(settings: Settings, name: str) -> str:
    return str(getattr(settings, name) or "")


def resolve_llm_spec(task: str, settings: Settings | None = None) -> ModelSpec:
    settings = settings or get_settings()
    if task not in LLM_TASKS:
        known = ", ".join(sorted(LLM_TASKS))
        raise KeyError(f"Unknown LLM task {task!r}. Known: {known}")
    override, default_field = LLM_TASKS[task]
    return parse_spec(_field(settings, override), fallback=_field(settings, default_field))


def resolve_embedding_spec(task: str, settings: Settings | None = None) -> ModelSpec:
    settings = settings or get_settings()
    if task not in EMBEDDING_TASKS:
        known = ", ".join(sorted(EMBEDDING_TASKS))
        raise KeyError(f"Unknown embedding task {task!r}. Known: {known}")
    override, default_field = EMBEDDING_TASKS[task]
    return parse_spec(_field(settings, override), fallback=_field(settings, default_field))


class ModelGateway:
    def __init__(self, settings: Settings | None = None, usage: UsageLogger | None = None) -> None:
        self._settings = settings or get_settings()
        self._usage = usage or NullUsageLogger()
        self._llm_cache: dict[str, LLMProvider] = {}
        self._embed_cache: dict[str, EmbeddingProvider] = {}

    def llm_for(self, task: str) -> LLMProvider:
        spec = resolve_llm_spec(task, self._settings)
        key = f"{task}:{spec}"
        if key not in self._llm_cache:
            inner = create_llm(spec.provider, spec.model)
            self._llm_cache[key] = wrap_llm(
                inner,
                task=task,
                usage=self._usage,
                max_retries=self._settings.model_max_retries,
            )
        return self._llm_cache[key]

    def embedding_for(self, task: str) -> EmbeddingProvider:
        spec = resolve_embedding_spec(task, self._settings)
        key = f"{task}:{spec}"
        if key not in self._embed_cache:
            inner = create_embedding(spec.provider, spec.model)
            self._embed_cache[key] = wrap_embedding(
                inner,
                task=task,
                usage=self._usage,
                max_retries=self._settings.model_max_retries,
            )
        return self._embed_cache[key]

    def generate(
        self,
        task: str,
        prompt: str,
        *,
        system: Optional[str] = None,
        json_mode: bool = False,
        **kwargs: object,
    ) -> LLMResponse:
        return self.llm_for(task).generate(prompt, system=system, json_mode=json_mode, **kwargs)

    def generate_json(self, task: str, prompt: str, schema: type[T], *, system: str | None = None) -> T:
        parsed, _response = _generate_json(self.llm_for(task), prompt, schema, system=system)
        return parsed

    def embed(self, task: str, texts: Sequence[str]) -> EmbeddingResult:
        if not texts:
            provider = self.embedding_for(task)
            return EmbeddingResult(
                vectors=[],
                provider=provider.provider_name,
                model=provider.model_name,
                dimensions=provider.dimensions,
                namespace=provider.namespace,
            )
        return self.embedding_for(task).embed(texts)

    def routing(self) -> dict[str, dict[str, str]]:
        llm = {task: str(resolve_llm_spec(task, self._settings)) for task in LLM_TASKS}
        embeddings = {
            task: str(resolve_embedding_spec(task, self._settings)) for task in EMBEDDING_TASKS
        }
        return {"llm": llm, "embeddings": embeddings}

    def diagnostics(self) -> dict:
        return {
            "registered_llm_providers": list_llm_providers(),
            "registered_embedding_providers": list_embedding_providers(),
            "routing": self.routing(),
        }


@lru_cache
def get_shared_gateway() -> ModelGateway:
    """Process-wide gateway with a null usage logger (no request session)."""
    return ModelGateway()


def reset_shared_gateway() -> None:
    get_shared_gateway.cache_clear()
