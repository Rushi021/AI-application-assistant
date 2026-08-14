"""Every registered adapter satisfies the port and reports coherent capabilities."""

import app.modules.ai.providers  # noqa: F401
import pytest

from app.modules.ai.ports import EmbeddingProvider, LLMProvider, ModelCapabilities
from app.modules.ai.registry import (
    create_embedding,
    create_llm,
    list_embedding_providers,
    list_llm_providers,
)


@pytest.mark.parametrize("name", list_llm_providers())
def test_llm_adapter_contract(name):
    provider = create_llm(name, "contract-model")
    assert isinstance(provider, LLMProvider)
    assert provider.provider_name
    assert provider.model_name
    caps = provider.capabilities()
    assert isinstance(caps, ModelCapabilities)
    assert caps.max_input_tokens > 0
    if name == "fake":
        response = provider.generate("hello", json_mode=False)
        assert response.text
        assert response.provider == "fake"


@pytest.mark.parametrize("name", list_embedding_providers())
def test_embedding_adapter_contract(name):
    provider = create_embedding(name, "contract-model")
    assert isinstance(provider, EmbeddingProvider)
    caps = provider.capabilities()
    assert caps.dimensions and caps.dimensions > 0
    assert ":" in provider.namespace
    if name == "fake":
        result = provider.embed(["alpha", "beta"])
        assert len(result.vectors) == 2
        assert result.dimensions == caps.dimensions
        assert result.namespace == provider.namespace
