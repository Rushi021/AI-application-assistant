"""Reroute every task to fake adapters through config only — no code edits."""

from app.modules.ai.gateway import ModelGateway, reset_shared_gateway
from app.modules.ai.ports import LLMProvider, EmbeddingProvider
from app.modules.matching.schemas import RequirementList


def test_provider_swap_via_config(monkeypatch):
    monkeypatch.setenv("LLM_DEFAULT", "fake:fake")
    monkeypatch.setenv("LLM_JD_EXTRACTION", "fake:offline")
    monkeypatch.setenv("LLM_RESUME_TAILOR", "fake:offline")
    monkeypatch.setenv("LLM_BULLET_REWRITE", "fake:offline")
    monkeypatch.setenv("LLM_COVER_LETTER", "fake:offline")
    monkeypatch.setenv("EMBEDDING_DEFAULT", "fake:offline")
    monkeypatch.setenv("EMBEDDING_REQUIREMENT", "fake:offline")
    monkeypatch.setenv("EMBEDDING_RESUME", "fake:offline")
    from app.core.config import get_settings

    get_settings.cache_clear()
    reset_shared_gateway()
    gateway = ModelGateway()
    routing = gateway.routing()
    assert all(spec.startswith("fake:") for spec in routing["llm"].values())
    assert all(spec.startswith("fake:") for spec in routing["embeddings"].values())

    parsed = gateway.generate_json(
        "jd_extraction",
        "Job description:\n---\nRequired: Python, SQL\n---",
        RequirementList,
    )
    assert parsed.requirements
    tailored = gateway.generate("resume_tailor", "Original resume:\n---\nPython dev\n---")
    assert tailored.provider == "fake"
    embedded = gateway.embed("requirement_embedding", ["Python"])
    assert embedded.provider == "fake"
    assert embedded.namespace.startswith("fake:")

    llm = gateway.llm_for("jd_extraction")
    emb = gateway.embedding_for("requirement_embedding")
    assert isinstance(llm, LLMProvider)
    assert isinstance(emb, EmbeddingProvider)
