"""Local ChatGPT plan authorization. Run from backend: python3 -m ... login.

Uses the documented SIWC public-client flow, not Codex's private credential file.
This credential store is for a single-user, locally hosted backend.
"""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import uuid
import webbrowser

import httpx

from app.core.config import get_settings

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
TOKEN_URL = f"{ISSUER}/api/accounts/oauth/token"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
_thread_lock = threading.Lock()


def auth_path() -> Path:
    return Path(get_settings().chatgpt_auth_file).expanduser().resolve()


@contextmanager
def _locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with _thread_lock:
        fd = os.open(str(path) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        with os.fdopen(fd, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


def _read(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def _save(path: Path, record: dict) -> None:
    # mkstemp creates a private file. Atomic replacement keeps tokens together.
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".chatgpt-")
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(record, output)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _exchange(data: dict) -> dict:
    with httpx.Client(timeout=30) as client:
        response = client.post(TOKEN_URL, data={**data, "resource": RESOURCE})
    if not response.is_success:
        # Never include a token response or credential in diagnostics.
        raise RuntimeError(f"ChatGPT authorization failed (HTTP {response.status_code}); run login again")
    return response.json()


def _with_tokens(record: dict, tokens: dict) -> dict:
    scopes = tokens.get("scope", " ".join(record.get("scopes", []))).split()
    if not {"resource.invoke", "chatgpt.tokens.use.direct"}.issubset(scopes):
        raise RuntimeError("ChatGPT plan usage was not authorized. Run login and grant plan access.")
    if not tokens.get("access_token"):
        raise RuntimeError("ChatGPT authorization returned no access token")
    return {
        **record, **tokens, "scopes": scopes,
        "expires_at": time.time() + float(tokens["expires_in"]),
    }


def access_token() -> str:
    path = auth_path()
    # Both threads (tailor + cover letter) and worker processes share this lock.
    with _locked(path):
        record = _read(path)
        if not record.get("access_token"):
            raise RuntimeError("ChatGPT is not connected. From backend run: python3 -m app.modules.ai.chatgpt_auth login")
        if record.get("expires_at", 0) <= time.time() + 60:
            if not record.get("refresh_token"):
                raise RuntimeError("ChatGPT session expired. Run ChatGPT login again.")
            tokens = _exchange({
                "grant_type": "refresh_token", "client_id": record["client_id"],
                "refresh_token": record["refresh_token"],
            })
            record = _with_tokens(record, tokens)
            _save(path, record)
        return record["access_token"]


def _validate_identity(token: str, client_id: str, nonce: str) -> dict:
    import jwt

    with httpx.Client(timeout=30) as client:
        discovery = client.get(f"{ISSUER}/.well-known/openid-configuration")
        discovery.raise_for_status()
        metadata = discovery.json()
        if metadata["issuer"] != ISSUER:
            raise RuntimeError("Unexpected ChatGPT identity issuer")
        keys = client.get(metadata["jwks_uri"])
        keys.raise_for_status()
    header = jwt.get_unverified_header(token)
    key = next(k for k in keys.json()["keys"] if k.get("kid") == header.get("kid"))
    claims = jwt.decode(
        token, jwt.PyJWK.from_dict(key).key, algorithms=["RS256"],
        audience=client_id, issuer=ISSUER,
        options={"require": ["exp", "iss", "aud", "sub", "nonce"]},
    )
    if not secrets.compare_digest(claims["nonce"], nonce):
        raise RuntimeError("ChatGPT identity nonce did not match")
    return claims


def _callback(query: dict, state: str, saved_client: str | None) -> tuple[str, str]:
    if not secrets.compare_digest(query.get("state", [""])[0], state):
        raise RuntimeError("ChatGPT callback state did not match")
    if query.get("error"):
        raise RuntimeError("ChatGPT authorization was declined or failed")
    client_id = query.get("client_id", [saved_client])[0]
    if not client_id or client_id == "dynamic_agent_client":
        raise RuntimeError("ChatGPT registration did not return an issued client ID")
    if saved_client and saved_client != client_id:
        raise RuntimeError("ChatGPT callback changed the selected client ID")
    code = query.get("code", [""])[0]
    if not code:
        raise RuntimeError("ChatGPT callback did not return an authorization code")
    return client_id, code


def login() -> None:
    path = auth_path()
    with _locked(path):
        record = _read(path)
        record.setdefault("ext_agent_host_id", f"urn:uuid:{uuid.uuid4()}")
        _save(path, record)  # Persist the host identity before first sign-in.
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    callback = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            valid = parsed.path == "/auth/callback" and query.get("state", [""])[0] == state
            self.send_response(200 if valid else 400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            if valid:
                callback.update(query)
            self.wfile.write(b"Return to the terminal to finish connecting." if valid else b"Invalid callback.")

        def log_message(self, *args):
            pass  # Callback URLs contain authorization codes.

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        server.timeout = 1
        redirect_uri = f"http://127.0.0.1:{server.server_port}/auth/callback"
        params = {
            "client_id": record.get("client_id", "dynamic_agent_client"),
            "ext_agent_host_id": record["ext_agent_host_id"],
            "response_type": "code", "redirect_uri": redirect_uri,
            "scope": SCOPES, "resource": RESOURCE, "state": state, "nonce": nonce,
            "code_challenge_method": "S256",
            "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("="),
        }
        if not record.get("client_id"):
            params["agent_name_hint"] = "AI Job Application Assistant"
        # Leave out ID-token hints so the URL printed below contains no tokens.
        url = f"{ISSUER}/api/accounts/authorize?{urlencode(params)}"
        print(f"Continue with ChatGPT in your browser:\n{url}")
        webbrowser.open(url)
        deadline = time.monotonic() + 300
        while not callback and time.monotonic() < deadline:
            server.handle_request()
    if not callback:
        raise RuntimeError("ChatGPT sign-in timed out; run login again")
    client_id, code = _callback(callback, state, record.get("client_id"))
    tokens = _exchange({
        "grant_type": "authorization_code", "client_id": client_id,
        "code": code, "code_verifier": verifier, "redirect_uri": redirect_uri,
    })
    identity = _validate_identity(tokens["id_token"], client_id, nonce)
    if record.get("subject") and record["subject"] != identity["sub"]:
        raise RuntimeError("Signed-in ChatGPT identity differs from the saved account")
    record = _with_tokens({
        **record, "client_id": client_id, "subject": identity["sub"],
        "email": identity.get("email", ""), "issuer": ISSUER,
    }, tokens)
    with _locked(path):
        _save(path, record)
    print("ChatGPT plan connected. Run the models command to see available model IDs.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Connect this local backend to your ChatGPT plan")
    parser.add_argument("command", choices=["login", "models"])
    args = parser.parse_args()
    if args.command == "login":
        login()
    else:
        with httpx.Client(timeout=30) as client:
            response = client.get(f"{RESOURCE}/models", headers={"Authorization": f"Bearer {access_token()}"})
        response.raise_for_status()
        for model in response.json()["models"]:
            if model.get("visibility") == "list":
                print(f"{model['slug']}  {model['display_name']}")


if __name__ == "__main__":
    main()
