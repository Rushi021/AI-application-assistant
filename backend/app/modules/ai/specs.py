"""Parse `provider:model` spec strings used for per-task routing."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    provider: str
    model: str

    def __str__(self) -> str:
        return f"{self.provider}:{self.model}"


class SpecError(ValueError):
    pass


def parse_spec(spec: str, *, fallback: str | None = None) -> ModelSpec:
    """Parse `provider:model`. Empty spec uses fallback. Model names may contain colons."""
    raw = (spec or "").strip() or (fallback or "").strip()
    if not raw:
        raise SpecError("Empty model spec and no fallback")
    if ":" not in raw:
        raise SpecError(
            f"Invalid model spec {raw!r}; expected 'provider:model' (e.g. gemini:gemini-1.5-flash)"
        )
    provider, model = raw.split(":", 1)
    provider = provider.strip().lower()
    model = model.strip()
    if not provider or not model:
        raise SpecError(f"Invalid model spec {raw!r}")
    return ModelSpec(provider=provider, model=model)
