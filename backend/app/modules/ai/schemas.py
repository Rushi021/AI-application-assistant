from pydantic import BaseModel, Field


class ModelsDiagnostics(BaseModel):
    registered_llm_providers: list[str]
    registered_embedding_providers: list[str]
    routing: dict[str, dict[str, str]]
