from pydantic import BaseModel, Field


class ModelsDiagnostics(BaseModel):
    registered_llm_providers: list[str]
    registered_embedding_providers: list[str]
    routing: dict[str, dict[str, str]]


class TailoredLine(BaseModel):
    """One rewritten resume line, addressed by the id it was offered under."""

    id: int
    text: str


class TailoredLines(BaseModel):
    items: list[TailoredLine] = Field(default_factory=list)
