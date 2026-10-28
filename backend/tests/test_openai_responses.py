"""Responses contract and local subscription authentication, without vendor calls."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
import json
import sys
import time
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest

from app.core.config import Settings
from app.modules.ai import chatgpt_auth as auth
from app.modules.ai.gateway import LLM_TASKS, ModelGateway, resolve_llm_spec
from app.modules.ai.providers.llm.openai import ChatGPTLLMProvider, OpenAILLMProvider


@pytest.fixture
def sdk(monkeypatch):
    create = Mock()
    client = Mock(responses=NS(create=create))
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=False)
    factory = Mock(return_value=client)
    monkeypatch.setitem(sys.modules, "openai", NS(OpenAI=factory))
    return factory, create


def completed(text="Done"):
    return NS(type="response.completed", response=NS(
        output_text=text, usage=NS(input_tokens=12, output_tokens=7),
    ))


def test_subscription_responses_json_and_usage(sdk, monkeypatch):
    factory, create = sdk
    monkeypatch.setattr(auth, "access_token", lambda: "oauth-token")
    create.return_value = nullcontext(iter([completed('{"items": []}')]))
    result = ChatGPTLLMProvider("account-model").generate(
        "Return JSON", system="Only JSON", json_mode=True,
    )
    assert factory.call_args.kwargs["api_key"] == "oauth-token"
    assert create.call_args.kwargs == {
        "model": "account-model", "input": [{"role": "user", "content": "Return JSON"}],
        "store": False, "stream": True, "instructions": "Only JSON",
        "text": {"format": {"type": "json_object"}},
    }
    assert result.provider == "chatgpt"
    assert (result.input_tokens, result.output_tokens) == (12, 7)
    assert result.text == '{"items": []}'


@pytest.mark.parametrize("events", [
    [], [NS(type="response.output_text.delta", delta="partial")],
    [NS(type="response.failed", response=NS(error=NS(code="subscription_sharing_usage_limit_exceeded")))],
    [NS(type="response.incomplete")], [NS(type="error", code="unavailable")],
    [completed("")],
])
def test_rejects_failed_incomplete_and_empty_output(sdk, monkeypatch, events):
    monkeypatch.setattr(auth, "access_token", lambda: "oauth-token")
    sdk[1].return_value = nullcontext(iter(events))
    with pytest.raises(RuntimeError):
        ChatGPTLLMProvider("model").generate("letter")


def test_subscription_never_falls_back_to_api_key(sdk, monkeypatch):
    monkeypatch.setattr(auth, "access_token", Mock(side_effect=RuntimeError("not connected")))
    provider = ChatGPTLLMProvider("model")
    provider._api_key = "paid-api-key"
    with pytest.raises(RuntimeError, match="not connected"):
        provider.generate("letter")
    sdk[0].assert_not_called()


def test_api_key_provider_uses_responses(sdk):
    provider = OpenAILLMProvider("model")
    provider._api_key = "api-key"
    sdk[1].return_value = nullcontext(iter([completed()]))
    assert provider.generate("letter").text == "Done"
    assert sdk[0].call_args.kwargs["api_key"] == "api-key"


def test_subscription_uses_deltas_when_completed_output_is_empty(sdk, monkeypatch):
    monkeypatch.setattr(auth, "access_token", lambda: "oauth-token")
    sdk[1].return_value = nullcontext(iter([
        NS(type="response.output_text.delta", delta="Cover "),
        NS(type="response.output_text.delta", delta="letter"),
        completed(""),
    ]))
    result = ChatGPTLLMProvider("model").generate("letter")
    assert result.text == "Cover letter"
    assert result.output_tokens == 7


def test_subscription_discards_deltas_on_failure(sdk, monkeypatch):
    monkeypatch.setattr(auth, "access_token", lambda: "oauth-token")
    sdk[1].return_value = nullcontext(iter([
        NS(type="response.output_text.delta", delta="Unfinished letter"),
        NS(type="response.failed", response=NS(error=NS(code="subscription_sharing_usage_limit_exceeded"))),
    ]))
    with pytest.raises(RuntimeError, match="subscription_sharing_usage_limit_exceeded"):
        ChatGPTLLMProvider("model").generate("letter")


@pytest.fixture
def credentials(tmp_path, monkeypatch):
    path = tmp_path / "auth.json"
    monkeypatch.setattr(auth, "auth_path", lambda: path)
    return path


def test_refresh_is_serialized_and_saved_privately(credentials, monkeypatch):
    credentials.write_text(json.dumps({
        "client_id": "issued", "access_token": "expired", "refresh_token": "old-refresh",
        "expires_at": 0, "scopes": auth.SCOPES.split(),
    }))
    exchange = Mock(return_value={
        "access_token": "renewed", "refresh_token": "rotated", "expires_in": 3600,
    })
    monkeypatch.setattr(auth, "_exchange", exchange)
    with ThreadPoolExecutor(2) as executor:
        results = list(executor.map(lambda _: auth.access_token(), range(2)))
    assert results == ["renewed", "renewed"]
    exchange.assert_called_once_with({
        "grant_type": "refresh_token", "client_id": "issued", "refresh_token": "old-refresh",
    })
    assert json.loads(credentials.read_text())["refresh_token"] == "rotated"
    assert credentials.stat().st_mode & 0o777 == 0o600


def test_missing_login_is_actionable(credentials):
    with pytest.raises(RuntimeError, match="chatgpt_auth login"):
        auth.access_token()


@pytest.mark.parametrize("query,saved", [
    ({"state": ["wrong"]}, None),
    ({"state": ["ok"], "error": ["access_denied"]}, None),
    ({"state": ["ok"], "code": ["code"]}, None),
    ({"state": ["ok"], "code": ["code"], "client_id": ["other"]}, "saved"),
])
def test_rejects_untrusted_callbacks(query, saved):
    with pytest.raises(RuntimeError):
        auth._callback(query, "ok", saved)


def test_returning_callback_reuses_client():
    assert auth._callback({"state": ["ok"], "code": ["code"]}, "ok", "saved") == ("saved", "code")


def test_denied_plan_scope():
    with pytest.raises(RuntimeError, match="not authorized"):
        auth._with_tokens({}, {"scope": "openid", "access_token": "identity-only"})


def test_default_writing_routes(monkeypatch):
    for name in ("LLM_DEFAULT", "LLM_JD_EXTRACTION", "LLM_RESUME_TAILOR", "LLM_BULLET_REWRITE", "LLM_COVER_LETTER", "EMBEDDING_DEFAULT", "EMBEDDING_REQUIREMENT", "EMBEDDING_RESUME"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    for task in LLM_TASKS:
        assert resolve_llm_spec(task, settings).provider == "chatgpt"
    assert all(route.startswith("sentence_transformers:") for route in ModelGateway(settings).routing()["embeddings"].values())


def test_old_gemini_configuration_migrates_without_vendor_calls():
    settings = Settings(
        _env_file=None, llm_default="gemini:old", llm_jd_extraction="gemini:old",
        llm_resume_tailor="gemini:old", llm_bullet_rewrite="gemini:old",
        llm_cover_letter="gemini:old", embedding_default="gemini:old",
        embedding_requirement="gemini:old", embedding_resume="gemini:old",
    )
    routing = ModelGateway(settings).routing()
    assert all(route.startswith("chatgpt:") for route in routing["llm"].values())
    assert all(route.startswith("sentence_transformers:") for route in routing["embeddings"].values())


@pytest.mark.parametrize("invalid", [None, "nonce", "aud", "exp", "signature"])
def test_id_token_verifies_signature_and_claims(monkeypatch, invalid):
    import httpx
    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = "test-key"
    claims = {
        "iss": auth.ISSUER, "aud": "issued", "sub": "user", "nonce": "nonce",
        "exp": time.time() + 300,
    }
    if invalid in {"nonce", "aud"}:
        claims[invalid] = "wrong"
    elif invalid == "exp":
        claims["exp"] = time.time() - 100
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048) if invalid == "signature" else key
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test-key"})

    def route(request):
        body = {"issuer": auth.ISSUER, "jwks_uri": f"{auth.ISSUER}/jwks"}
        if request.url.path == "/jwks":
            body = {"keys": [jwk]}
        return httpx.Response(200, json=body)

    client = httpx.Client(transport=httpx.MockTransport(route))
    monkeypatch.setattr(auth.httpx, "Client", lambda **kwargs: client)
    if invalid:
        with pytest.raises((jwt.InvalidTokenError, RuntimeError)):
            auth._validate_identity(token, "issued", "nonce")
    else:
        assert auth._validate_identity(token, "issued", "nonce")["sub"] == "user"
