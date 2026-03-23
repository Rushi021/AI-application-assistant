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
- `chrome-extension/src/background/`: Service worker for auth token retrieval, message routing, and autofill/session orchestration.
- `chrome-extension/src/content/`: Content scripts for DOM/form modeling, matching, autofill execution, and SPA observation.
- `chrome-extension/src/sidepanel/`: React sidepanel app (pages, hooks, store, API client).
- `chrome-extension/src/shared/`: Shared constants/types and DOM runtime engine.
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
- Sidepanel and content scripts communicate through the background service worker with `chrome.runtime.sendMessage`; background relays to tab/frame contexts with `chrome.tabs.sendMessage`.
- Autofill orchestration convention: sidepanel triggers `START_AUTOFILL` -> background injects/targets content scripts by frame -> content script executes autofill state machine and reports progress/diagnostics via `AUTOFILL_PROGRESS` and `AUTOFILL_DIAG_TRACE`.
- Extension auth/session storage convention: `access_token`, `refresh_token`, and `session_id` are stored in `chrome.storage.local`; API client attaches `Authorization` and `X-Session-Id` and retries 401 via `/auth/refresh`.

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
<!-- Intentionally left blank for manual authoring. -->

# Rules and non-negotiables
<!-- Intentionally left blank for manual authoring. -->

# Off-limits files
<!-- Intentionally left blank for manual authoring. -->

# Known issues and decisions made through debugging
<!-- Intentionally left blank for manual authoring. -->
