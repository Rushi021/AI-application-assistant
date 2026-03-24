# Project overview
This repository is an AI job application assistant with three main parts: a FastAPI backend, a Chrome extension, and a Streamlit workflow UI. The backend manages auth, profile/resume/job/application/draft APIs and uses session-scoped data access with `X-Session-Id`, while the extension drives login, resume workflow, and in-page autofill automation. The Streamlit app is a separate client for testing the backend workflow end-to-end.

# Repo structure
- `backend/`: FastAPI service, SQLAlchemy models/repos, Alembic migrations, and backend tests.
- `backend/app/main.py`: App entrypoint; mounts auth/users/resumes/jobs/pipeline/applications/drafts routers.
- `backend/app/core/`: Settings, dependency wiring, logging, auth/security helpers.
- `backend/app/common/`: Shared ports/adapters, errors, utilities, resume parsing/docx services.
- `backend/app/db/`: SQLAlchemy session/base and Alembic environment/versions.
- `backend/app/modules/`: Domain modules (`auth`, `users`, `resumes`, `jobs`, `pipeline`, `applications`, `drafts`, `ai`, `chat`).
- `backend/tests/`: Python tests (currently parser-focused tests in `test_resume_parser.py`).
- `backend/data/resumes/`: Local file storage location used by the local storage adapter.
- `chrome-extension/`: MV3 extension project (TypeScript + React + Vite).
- `chrome-extension/src/background/`: Service worker for auth token retrieval, message routing, and application tracking writes.
- `chrome-extension/src/content/`: Content script (`autofill.ts` only) — DOM scanning/matching/filling, upload blocker detection, and mutation-driven re-run.
- `chrome-extension/src/sidepanel/`: React sidepanel app (pages, hooks, store, API client).
- `chrome-extension/src/shared/`: Shared constants/types and answer-map builder (`autofill-answers.ts`).
- `chrome-extension/public/`: Static icons.
- `chrome-extension/dist/`: Built extension output for loading unpacked.
- `streamlit_app/`: Standalone Streamlit client app (`app.py`) and its own requirements file.
- `.venv/`: Local virtual environment in repo root.
- `.cursor/`: Present but empty in current snapshot.

# How to run each part
## Backend (local)
```bash
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Backend (container)
```bash
cd backend
docker compose up --build
```

## Backend (start script)
```bash
cd backend
bash start.sh
```

## Chrome extension
```bash
cd chrome-extension
npm install
npm run build
```
Then load unpacked extension from `chrome-extension/dist` in Chrome.

Watch-mode build command used by this repo:
```bash
cd chrome-extension
npm run dev
```

## Streamlit app
```bash
pip install -r streamlit_app/requirements.txt
streamlit run streamlit_app/app.py
```
The Streamlit client defaults to backend URL `http://localhost:8000`.

# Tech stack
## Python / backend
- Runtime base image: `python:3.11-slim` (from `backend/Dockerfile`).
- Web/API: `fastapi==0.111.0`, `uvicorn==0.30.1`.
- Data: `SQLAlchemy==2.0.30`, `alembic==1.13.1`.
- Validation/settings: `pydantic==2.7.1`, `pydantic-settings==2.2.1`.
- Auth/network/utilities: `PyJWT>=2.8.0`, `httpx>=0.27.0`, `python-dotenv==1.0.1`, `python-multipart==0.0.9`, `boto3>=1.34.0`.
- Document processing: `python-docx>=1.1.0`.
- LLM SDK: `google-generativeai>=0.8.0`.

Also present at repo root (`requirements.txt`):
- `fastapi>=0.115.0`, `uvicorn[standard]>=0.32.0`, `sqlalchemy>=2.0.0`, `pydantic>=2.0.0`, `pydantic-settings>=2.0.0`, `python-docx>=1.0.0`, `PyJWT>=2.8.0`, `httpx>=0.27.0`, `alembic>=1.13.0`, `google-generativeai>=0.8.0`, `streamlit>=1.40.0`, `requests>=2.31.0`.

## Streamlit app requirements
- `streamlit>=1.28.0`
- `requests>=2.28.0`

## Chrome extension (`chrome-extension/package.json`)
- App deps: `react^19.0.0`, `react-dom^19.0.0`, `zustand^5.0.0`, `lucide-react^0.468.0`.
- Tooling/dev: `typescript^5.6.0`, `vite^6.0.0`, `@vitejs/plugin-react^4.3.0`, `tailwindcss^3.4.17`, `postcss^8.4.49`, `autoprefixer^10.4.20`, `@types/chrome^0.0.287`, `@types/react^19.0.0`, `@types/react-dom^19.0.0`.

# Code patterns and conventions you observe
- Backend routing is module-based with `APIRouter(prefix=..., tags=[...])`, mounted centrally in `app/main.py`.
- Backend dependencies are injected via `Depends(...)`; common dependencies include `get_db`, `get_request_scope`, `get_current_user`, `get_current_user_model`, `get_resume_storage`, and `get_llm_provider`.
- Session scoping is a core convention: stateful domain queries are scoped by `session_id` (from `X-Session-Id` header), and repository interfaces enforce scoped methods like `get_by_scope`/`list_by_session`.
- Auth currently supports both JWT and a legacy test token path: JWT access/refresh token creation/validation in `core/security.py`, OAuth/dev login in `modules/auth/router.py`, and fallback test-token compatibility in auth deps.
- Error handling pattern: routers raise `HTTPException` (including `not_found(...)` helper usage) and serialize ORM objects through Pydantic response schemas.
- Resume/draft flow convention: resume is parsed to canonical JSON at upload, draft sections are generated from that JSON, section edits are tracked separately, and `apply-all` reconstructs a `.docx` while preserving formatting.
- Extension communication uses a shared message contract in `src/shared/constants.ts` (`MSG` keys).
- Extension auth/session storage convention: `access_token`, `refresh_token`, and `session_id` are stored in `chrome.storage.local`; API client attaches `Authorization` and `X-Session-Id` and retries 401 via `/auth/refresh`.
- Autofill answer-source convention: sidepanel writes flat answer map to `chrome.storage.session[autofill_answers]` at login/profile save (via `buildAutofillAnswersFromProfile`), and content script reads it directly.
- Autofill trigger convention: sidepanel sends one-way `{ action: "run_autofill" }` and updates `chrome.storage.session[autofill_trigger_ts]`; no answer payload is sent through runtime messages.
- Autofill execution ownership: `src/content/autofill.ts` owns scan -> match -> fill lifecycle, including text/select/checkbox/radio handling and event dispatch (`input/change/blur`), plus `MutationObserver` re-runs for SPA or multi-step DOM changes.
- Upload pause gateway convention: content script detects actionable file inputs (resume/cover letter), emits blocked progress (`AUTOFILL_PROGRESS`), and waits for user decision. Sidepanel records decision in `chrome.storage.session[autofill_upload_decisions]` and sends `AUTOFILL_UPLOAD_BLOCKER_DECISION` to resume.
- Progress/diagnostics convention: content script publishes `AUTOFILL_PROGRESS` and logs; sidepanel reads local progress/timeline state for UI. Background still relays cross-context messages and supports compatibility routes.
- ATS coverage: generic DOM matching/fill is the current strategy; no ATS-specific adapters are active.

# Test commands
Run backend parser tests from the backend directory:
```bash
cd backend
python -m pytest tests/test_resume_parser.py
```

Run all backend tests currently present:
```bash
cd backend
python -m pytest tests
```

No JavaScript/TypeScript test script is defined in `chrome-extension/package.json`.

# Architectural decisions
1. Autofill data path is content-local: no message-based transfer of field mappings or answer payloads from sidepanel/background to content.
2. `chrome.storage.session` is the source of truth for autofill inputs and trigger state:
   - `autofill_answers`
   - `autofill_trigger_ts`
   - `autofill_upload_decisions`
3. Sidepanel acts as a trigger and control surface; content script owns actual DOM mutation and paused/blocked decisions.
4. Upload blockers are explicit gates for file-upload steps to prevent false progress and to support user-confirmed resume source behavior.
5. Background remains orchestration/relay infrastructure (auth, message forwarding, track application API writes), not field-level autofill execution.

# Rules and non-negotiables
- Do not reintroduce message-based answer transport for autofill payloads.
- Do not make content autofill wait on callback acknowledgements from sidepanel/background.
- Keep one-way trigger semantics (`run_autofill` + storage trigger stamp) for reliability.
- Keep upload-gate handling in place for resume/cover-letter file inputs before continuing fill.
- Persist user profile updates back into `autofill_answers` so content autofill stays in sync.

# Off-limits files
<!-- Intentionally left blank for manual authoring. -->

# Known issues and decisions made through debugging
- `chrome.storage.session` requires `setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })` in the service worker so content scripts can read autofill answers/trigger/decisions.
- `chrome.storage.session` is ephemeral (cleared on browser restart or extension reload), so autofill answers must be rebuilt from the cached `USER_PROFILE` in `chrome.storage.local` on every service worker startup and sidepanel `initAuthState` call.
- Dynamic DOMs and highly unstable selectors can cause blocker-decision key churn; decisions are reset on new autofill start to avoid stale gating.
- Cross-origin iframe restrictions still apply to any extension content script strategy; reliability depends on content script presence in target frame.
- Current matcher is intentionally simple (normalized contains/overlap). Accuracy is good for common fields, but long-tail custom questions may still need adapter/rule improvements.
- Dead code from a prior "unified autofill engine" (dom-runtime, form-model, field-matcher, spa-observer, site-learning, ATS adapters, dom-control-engine) was removed; do not reintroduce those patterns.
