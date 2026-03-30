"""
End-to-end API integration tests against a deployed backend (e.g. Render).

Environment:
  API_INTEGRATION_BASE_URL — optional override for the API root (no trailing slash).
    If unset and RUN_INTEGRATION_TESTS=1, the default matches chrome-extension
    `src/shared/constants.ts` (API_BASE_URL).
  RUN_INTEGRATION_TESTS — set to 1/true/yes/on to run this file when API_INTEGRATION_BASE_URL
    is unset (uses the extension default Render URL). If set to 0/false/no/off, tests skip.
    If API_INTEGRATION_BASE_URL is set to a real URL, it wins. Placeholder tutorial URLs in that
    env var are ignored when RUN_INTEGRATION_TESTS=1 so a stale shell variable does not skip tests.

Run against deployed API (same host as the extension):
  cd backend && pip install -r requirements.txt
  $env:RUN_INTEGRATION_TESTS="1"; py -m pytest tests/test_api_integration.py -v

Run against another base URL:
  $env:API_INTEGRATION_BASE_URL="http://127.0.0.1:8765"; py -m pytest tests/test_api_integration.py -v
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
import pytest

# Keep in sync with chrome-extension/src/shared/constants.ts (API_BASE_URL).
EXTENSION_API_BASE_URL = "https://ai-job-assistant-api-a3c1.onrender.com"

JOB_DESCRIPTION = """Senior Backend Engineer

We need strong Python experience and AWS for our cloud platform.
Nice to have: Kubernetes and Terraform.
"""


def _url_looks_like_readme_placeholder(url: str) -> bool:
    """True when env still has tutorial text instead of a real Render hostname."""
    low = url.lower()
    needles = (
        "your-actual-render",
        "your-actual-service",
        "your-service.onrender",
        "your-app.onrender",
        "changeme.onrender",
        "example.onrender",
    )
    return any(n in low for n in needles)


def _resolve_integration_base_url() -> str | None:
    """
    Explicit API_INTEGRATION_BASE_URL wins unless it looks like a docs placeholder (then ignored).
    When unset or placeholder, RUN_INTEGRATION_TESTS=1 uses EXTENSION_API_BASE_URL (Chrome extension).
    """
    explicit = os.environ.get("API_INTEGRATION_BASE_URL", "").strip()
    if explicit:
        url = explicit.rstrip("/")
        if not _url_looks_like_readme_placeholder(url):
            return url
        # Stale shell / machine env often still has tutorial URLs; do not skip when RUN=1.
    run_flag = os.environ.get("RUN_INTEGRATION_TESTS", "").strip().lower()
    if run_flag in ("1", "true", "yes", "on"):
        return EXTENSION_API_BASE_URL.rstrip("/")
    return None


def _integration_disabled() -> bool:
    v = os.environ.get("RUN_INTEGRATION_TESTS", "").strip().lower()
    return v in ("0", "false", "no", "off")


def _api_root(client: httpx.Client) -> str:
    return str(client.base_url).rstrip("/")


def _preflight_api(client: httpx.Client) -> None:
    """Confirm the base URL points at this FastAPI app (not a 404 CDN page)."""
    root = _api_root(client)
    r = client.get("/health")
    if r.status_code == 200:
        try:
            if r.json().get("status") == "ok":
                return
        except Exception:
            pass
    r_root = client.get("/")
    h_snip = (r.text or "")[:500]
    root_snip = (r_root.text or "")[:500]
    pytest.fail(
        f"API preflight failed.\n"
        f"  GET {root}/health -> {r.status_code} body={h_snip!r}\n"
        f"  GET {root}/ -> {r_root.status_code} body={root_snip!r}\n"
        f"Set API_INTEGRATION_BASE_URL to the URL shown in the Render dashboard for your web service "
        f"(e.g. https://<your-service-name>.onrender.com), with no /docs suffix. "
        f"Strings like 'your-actual-render-url' are placeholders, not real hostnames."
    )


@pytest.fixture(scope="module")
def api_base_url() -> str:
    if _integration_disabled():
        pytest.skip("RUN_INTEGRATION_TESTS is disabled")
    url = _resolve_integration_base_url()
    if not url:
        pytest.skip(
            "Set API_INTEGRATION_BASE_URL, or set RUN_INTEGRATION_TESTS=1 to use the same URL as "
            "chrome-extension/src/shared/constants.ts (API_BASE_URL)."
        )
    if _url_looks_like_readme_placeholder(url):
        pytest.skip(
            "API_INTEGRATION_BASE_URL still looks like a documentation placeholder "
            "(e.g. your-actual-render-url.onrender.com). Replace it with your real Render URL "
            "from the Render dashboard."
        )
    return url


@pytest.fixture(scope="module")
def api_client(api_base_url: str, integration_session_id: str) -> httpx.Client:
    headers = {"X-Session-Id": integration_session_id}
    return httpx.Client(
        base_url=api_base_url,
        headers=headers,
        timeout=httpx.Timeout(120.0, connect=15.0),
        follow_redirects=True,
    )


@pytest.mark.integration
def test_e2e_resume_workflow(
    api_client: httpx.Client,
    minimal_resume_docx_bytes: bytes,
) -> None:
    docx = minimal_resume_docx_bytes
    filename = "resume.docx"
    content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    # Preflight
    _preflight_api(api_client)

    # 1. UPLOAD (client_stored=true)
    r1 = api_client.post(
        "/resumes/upload",
        params={"client_stored": "true"},
        files={"file": (filename, docx, content_type)},
    )
    assert r1.status_code == 200, f"{r1.status_code} {r1.text}"
    up1: dict[str, Any] = r1.json()
    assert "id" in up1
    assert up1.get("client_stored") is True
    resume_id_v1 = int(up1["id"])

    # 2. LIST
    r2 = api_client.get("/resumes")
    assert r2.status_code == 200, r2.text
    listed = r2.json()
    assert any(int(x["id"]) == resume_id_v1 for x in listed)

    # 3. DELETE
    r3 = api_client.delete(f"/resumes/{resume_id_v1}")
    assert r3.status_code == 204, f"{r3.status_code} {r3.text}"

    r3b = api_client.get("/resumes")
    assert r3b.status_code == 200
    ids_after_delete = {int(x["id"]) for x in r3b.json()}
    assert resume_id_v1 not in ids_after_delete

    # 4. RE-UPLOAD
    r4 = api_client.post(
        "/resumes/upload",
        params={"client_stored": "true"},
        files={"file": (filename, docx, content_type)},
    )
    assert r4.status_code == 200, f"{r4.status_code} {r4.text}"
    up2 = r4.json()
    assert up2.get("client_stored") is True
    resume_id = int(up2["id"])

    # 5. KEYWORD / SCORE
    r5 = api_client.post(
        "/resumes/score",
        json={"job_description": JOB_DESCRIPTION, "resume_ids": [resume_id]},
    )
    assert r5.status_code == 200, f"{r5.status_code} {r5.text}"
    score_payload = r5.json()
    assert "scores" in score_payload and len(score_payload["scores"]) >= 1
    s0 = score_payload["scores"][0]
    assert "matched_keywords" in s0 and isinstance(s0["matched_keywords"], list)
    assert "missing_keywords" in s0 and isinstance(s0["missing_keywords"], list)
    # JD mentions Python/AWS; resume fixture includes them — expect at least one match
    assert len(s0["matched_keywords"]) >= 1, s0

    # 6. TAILOR — pipeline
    r6 = api_client.post(
        "/pipeline/run",
        json={"job_description": JOB_DESCRIPTION, "resume_id": resume_id},
    )
    assert r6.status_code == 200, f"{r6.status_code} {r6.text}"
    run = r6.json()
    assert run.get("status") == "completed", run
    assert run.get("tailored_sections"), "tailored_sections missing"
    json.loads(run["tailored_sections"])
    run_id = int(run["id"])

    # 7. CREATE DRAFT
    r7 = api_client.post(
        "/drafts",
        json={
            "base_resume_id": resume_id,
            "run_id": run_id,
            "starting_source": "tailored",
            "job_description": JOB_DESCRIPTION,
        },
    )
    assert r7.status_code == 200, f"{r7.status_code} {r7.text}"
    draft = r7.json()
    assert draft.get("sections"), "draft has no sections"
    draft_id = int(draft["id"])
    editable = next((sec for sec in draft["sections"] if sec.get("editable", True)), None)
    assert editable is not None, "no editable section"
    section_id = str(editable["section_id"])

    # 8. SECTION CHAT (refine with AI)
    r8 = api_client.post(
        f"/drafts/{draft_id}/sections/{section_id}/chat",
        json={"message": "Shorten this section slightly while keeping facts."},
    )
    assert r8.status_code == 200, f"{r8.status_code} {r8.text}"
    chat = r8.json()
    assert chat.get("proposed_text"), chat

    # 9. APPLY ALL (multipart resume_file required for client_stored)
    r9 = api_client.post(
        f"/drafts/{draft_id}/apply-all",
        files={"resume_file": (filename, docx, content_type)},
    )
    assert r9.status_code == 200, f"{r9.status_code} {r9.text}"
    body = r9.content
    assert len(body) > 100
    assert body[:2] == b"PK"
    ct = r9.headers.get("content-type", "")
    assert "wordprocessingml" in ct or "octet-stream" in ct

    # 10. COVER LETTER
    r10 = api_client.post(
        f"/drafts/{draft_id}/generate-cover-letter",
        json={},
    )
    assert r10.status_code == 200, f"{r10.status_code} {r10.text}"
    cl = r10.json()
    assert cl.get("cover_letter") and len(str(cl["cover_letter"]).strip()) > 20, cl
