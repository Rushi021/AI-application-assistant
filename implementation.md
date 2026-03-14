# AI Job Application Assistant - Implementation Guide

This document explains what is implemented in the backend today, how the architecture is organized, how users interact with the system, and how data flows across components.

## 1. Product Use Case Implemented

The backend supports a workflow where a user:

1. Authenticates (Google OAuth, dev login, or legacy test login).
2. Starts a session-scoped workspace (`X-Session-Id` header).
3. Uploads resumes (doc/docx/pdf; docx parsing is primary path).
4. Ingests job descriptions.
5. Runs AI tailoring to produce tailored resume text/sections.
6. Creates and edits draft sections with chat assistance.
7. Generates cover letters from draft context.
8. Tracks applications and application timeline events.

The system is built to preserve ownership boundaries by session and to keep architecture swappable for storage/LLM providers.

## 2. Tech Stack

The stack is split by component so each layer can evolve independently.

### 2.0 Runtime and language summary

- `Python` is the backend language (`backend/`) and powers API, data, auth, and AI orchestration layers.
- `JavaScript/TypeScript` is the extension frontend language (`chrome-extension/`) for UI, content scripts, and browser messaging.
- `Node.js + npm` are used as the build/runtime toolchain for the extension (`vite`, `tsc`, dependency management).
- `SQL` is used through SQLAlchemy models and migrations for relational data storage.

### 2.1 Backend API (`backend/`)

| Technology | Why it was used | How it is used |
|---|---|---|
| `FastAPI` | Fast development speed, typed contracts, built-in docs | Defines all REST endpoints, request parsing, dependency injection |
| `Uvicorn` | Lightweight high-performance ASGI server | Runs the FastAPI app locally and in deployment targets |
| `SQLAlchemy` | Mature ORM with clean model/repository support | Defines DB models and powers repository adapters |
| `Alembic` | Standard migration workflow for SQLAlchemy projects | Migration scaffold is in place for schema evolution |
| `Pydantic v2` + `pydantic-settings` | Strong validation + env-driven config | Request/response schemas and typed settings loading from `.env` |
| `PyJWT` | Simple JWT token handling | Access/refresh token creation and verification in auth/security layer |
| `httpx` | Modern async HTTP client | Verifies Google auth tokens and external HTTP calls |
| `python-multipart` | Required multipart parser | Supports resume file upload endpoints |
| `python-docx` | Reliable `.docx` read/write support | Resume parsing and generated document output paths |
| `google-generativeai` | Direct Gemini integration with low setup overhead | Adapter implementation for tailoring/chat/cover-letter flows |

Primary definitions: `backend/requirements.txt`.

### 2.2 Chrome Extension UI (`chrome-extension/`)

| Technology | Why it was used | How it is used |
|---|---|---|
| `TypeScript` | Safer refactors for fast-evolving logic | Typed extension messaging, autofill, diagnostics, API calls |
| `React` | Component-driven UI for multi-step workflows | Sidepanel pages (resume/job/pipeline/autofill interactions) |
| `Zustand` | Minimal global state without heavy boilerplate | Stores auth/session/workflow state across extension screens |
| `Vite` | Fast builds for extension development | Builds service worker, content script, and sidepanel bundles |
| `Tailwind CSS` + `PostCSS` | Rapid UI iteration with consistent utility styling | Styling and layout of extension panels and workflow screens |
| Chrome Extension APIs (`@types/chrome`) | Native browser integration | Tabs, storage, runtime messages, script injection for autofill |

Primary definitions: `chrome-extension/package.json`.

### 2.3 Local Demo Client (`streamlit_app/`)

| Technology | Why it was used | How it is used |
|---|---|---|
| `Streamlit` | Quick internal UI for API testing/demo | Lightweight local interface for validating backend flows |
| `requests` | Simple synchronous HTTP client | Calls backend endpoints from Streamlit actions |

Primary definitions: `streamlit_app/requirements.txt`.

## 3. Architecture Overview

### 3.1 Layered modular monolith

- `backend/app/main.py`
  - App creation, CORS middleware, router mounting, health endpoints.
- `backend/app/core/`
  - `config.py`: env-driven settings
  - `security.py`: JWT helpers, request scope validation
  - `deps.py`: dependency injection (DB, auth user, scope, storage, LLM)
  - `logging.py`: logging bootstrap
- `backend/app/db/`
  - DB base/session and Alembic environment
- `backend/app/common/`
  - `ports.py`: interfaces for storage, repos, LLM provider
  - `adapters/`: SQLAlchemy repos, local storage, S3 stub
  - parser/utilities/errors
- `backend/app/modules/`
  - feature modules (`auth`, `users`, `resumes`, `jobs`, `pipeline`, `drafts`, `applications`, `ai`, `chat`)

### 3.2 Ports and adapters

Contracts are defined in `backend/app/common/ports.py`:

- `LLMProvider`
- `ResumeStorage`
- `UserRepo`, `ResumeRepo`, `JobRepo`, `PipelineRunRepo`, `ApplicationRepo`, `ApplicationEventRepo`

Current adapters:

- `backend/app/common/adapters/sqlalchemy_repos.py`
- `backend/app/common/adapters/local_storage.py`
- `backend/app/modules/ai/providers/gemini_provider.py`

Future adapter placeholder:

- `backend/app/common/adapters/s3_storage.py` (stub)

## 4. Security and Ownership Model

### 4.1 Authentication

Implemented routes in `backend/app/modules/auth/router.py`:

- `POST /auth/google` -> exchange Google token for app JWT
- `POST /auth/refresh` -> refresh access token
- `POST /auth/dev-login` -> development-only JWT path
- `POST /auth/login` -> legacy test auth (static token)
- `GET /auth/me` -> current user info

JWT functions are in `backend/app/core/security.py`.

### 4.2 Request scope and session isolation

Most domain endpoints require `X-Session-Id` (UUID).  
`get_request_scope` in `backend/app/core/deps.py` builds:

- `session_id` (required, validated UUID)
- `user_id` (optional; resolved from JWT if available)

All key repos and routers scope reads/writes by session. This is the core data isolation boundary today.

## 5. Data Model Implemented

### 5.1 Core entities

- `users` (`backend/app/modules/users/models.py`)
  - authentication and profile fields (basic/professional/education/work auth/demographics/salary/custom)
- `resumes` (`backend/app/modules/resumes/models.py`)
  - session/user ownership, file metadata, hash, parsed JSON
- `jobs` (`backend/app/modules/jobs/models.py`)
  - raw JD text + ownership
- `pipeline_runs` (`backend/app/modules/pipeline/models.py`)
  - run inputs, status, tailored outputs
- `applications` and `application_events` (`backend/app/modules/applications/models.py`)
  - tracker records + append-only event timeline
- draft entities (`backend/app/modules/drafts/models.py`)
  - resume draft, draft sections, chat messages

### 5.2 Storage strategy

- Structured metadata and workflow state -> DB
- Resume files -> file storage adapter (local path for now)
- Parsed resume representation -> JSON text in DB (`resumes.parsed_json`)
- Tailored section output -> JSON text in DB (`pipeline_runs.tailored_sections`)

## 6. Implemented Components and Responsibilities

### 6.1 Auth component

- File: `backend/app/modules/auth/router.py`
- Handles Google and dev login flows and token refresh.
- Supports legacy test token for compatibility.

### 6.2 User profile component

- File: `backend/app/modules/users/router.py`
- Endpoints:
  - `GET /users/me/profile`
  - `PATCH /users/me/profile`
- Updates profile fields on authenticated `User`.

### 6.3 Resume component

- File: `backend/app/modules/resumes/router.py`
- Capabilities:
  - upload, list, get, delete resumes
  - score resumes against job description
  - reparse resume to refresh parser output
- Enforces per-session resume cap (`MAX_RESUMES_PER_SESSION = 2`).
- Parses docx at upload and stores canonical parsed JSON.

### 6.4 Jobs component

- File: `backend/app/modules/jobs/router.py`
- Endpoint:
  - `POST /jobs/ingest`
- Stores JD raw text with session ownership.

### 6.5 Pipeline component

- File: `backend/app/modules/pipeline/router.py`
- Endpoints:
  - `POST /pipeline/run`
  - `GET /pipeline/runs/{run_id}`
- Current mode: tailor resume only (`run_tailor_only`), stores results in `pipeline_runs`.
- Uses parsed resume JSON when available to perform section-aware tailoring.

### 6.6 Draft component

- File: `backend/app/modules/drafts/router.py`
- Endpoints support iterative editing workflow:
  - create/get/delete draft
  - section chat
  - patch section text
  - apply section
  - generate cover letter
  - apply all (returns final document bytes)
  - chat history retrieval

### 6.7 Applications component

- File: `backend/app/modules/applications/router.py`
- Endpoints:
  - create/list/get/update application
  - create/list application events
- Purpose: keep application state and timeline in one place.

## 7. End-to-End Data Workflow

### 7.1 Authentication and session bootstrap

1. User signs in via Google or dev login.
2. Backend returns access token (and refresh token for JWT paths).
3. Client generates/stores a UUID session and sends `X-Session-Id` on all data requests.
4. Backend resolves `RequestScope(session_id, user_id?)`.

### 7.2 Resume ingestion flow

1. Client uploads file -> `POST /resumes/upload`.
2. Backend validates extension/size.
3. `ResumeStorage.save_file` writes bytes to configured storage.
4. Backend parses docx into sectioned JSON (`parse_resume_to_json`).
5. Metadata + parsed JSON saved in `resumes`.
6. Client receives resume metadata + storage path reference.

### 7.3 Job ingest flow

1. Client posts JD text -> `POST /jobs/ingest`.
2. Backend stores job record with session ownership.
3. Job ID becomes reference for downstream flows.

### 7.4 Tailoring flow

1. Client calls `POST /pipeline/run` with `job_description` and `resume_id` or `resume_text`.
2. Backend resolves resume text:
  - from stored parsed JSON if available
  - otherwise from direct text input
3. Backend creates `pipeline_runs` row (`running`).
4. Orchestrator builds tailoring prompt and calls LLM provider.
5. Backend stores:
  - `tailored_resume`
  - optional `tailored_sections` JSON
  - final `status`
6. Client fetches run via `GET /pipeline/runs/{run_id}`.

### 7.5 Draft editing flow

1. Client creates draft from resume/pipeline context.
2. Section-level chat sends targeted prompt to LLM.
3. Client accepts/rejects and patches sections.
4. `apply-all` reconstructs final document with section updates.
5. Optional cover letter generation uses draft context + JD.

### 7.6 Application tracking flow

1. Client creates application linked to job/resume.
2. Status updates via patch endpoint.
3. Timeline events appended to `application_events`.
4. List/get endpoints provide current board state and history.

## 8. How Users Interact with the System

### 8.1 Required request headers

- `Authorization: Bearer <token>` for authenticated routes.
- `X-Session-Id: <uuid>` for session-scoped data routes.

### 8.2 Typical user interaction sequence

1. Login (`/auth/google` or `/auth/dev-login`).
2. Upload resume (`/resumes/upload`).
3. Ingest JD (`/jobs/ingest`).
4. Run tailoring (`/pipeline/run`).
5. Create/edit draft (`/drafts/...` endpoints).
6. Generate cover letter (`/drafts/{draft_id}/generate-cover-letter`).
7. Save tracker entry (`/applications`) and events.

## 9. Current API Surface (Implemented)

- Root/system:
  - `GET /`
  - `GET /health`
- Auth:
  - `POST /auth/google`
  - `POST /auth/refresh`
  - `POST /auth/dev-login`
  - `POST /auth/login` (legacy)
  - `GET /auth/me`
- Users:
  - `GET /users/me/profile`
  - `PATCH /users/me/profile`
- Resumes:
  - `POST /resumes/upload`
  - `GET /resumes`
  - `GET /resumes/{resume_id}`
  - `DELETE /resumes/{resume_id}`
  - `POST /resumes/score`
  - `POST /resumes/{resume_id}/reparse`
- Jobs:
  - `POST /jobs/ingest`
- Pipeline:
  - `POST /pipeline/run`
  - `GET /pipeline/runs/{run_id}`
- Drafts:
  - `POST /drafts`
  - `GET /drafts/{draft_id}`
  - `DELETE /drafts/{draft_id}`
  - `POST /drafts/{draft_id}/sections/{section_id}/chat`
  - `PATCH /drafts/{draft_id}/sections/{section_id}`
  - `POST /drafts/{draft_id}/sections/{section_id}/apply`
  - `POST /drafts/{draft_id}/generate-cover-letter`
  - `POST /drafts/{draft_id}/apply-all`
  - `GET /drafts/{draft_id}/sections/{section_id}/history`
- Applications:
  - `POST /applications`
  - `GET /applications`
  - `GET /applications/{application_id}`
  - `PATCH /applications/{application_id}`
  - `POST /applications/{application_id}/events`
  - `GET /applications/{application_id}/events`

## 10. Configuration and Runtime

Main runtime settings live in:

- `backend/.env.example`
- `backend/app/core/config.py`

Key config groups:

- app and environment
- DB URL
- storage backend and upload limits
- output paths for generated files
- auth settings (legacy + JWT + Google)
- LLM provider settings

## 11. What Is Stable vs Evolving

Stable foundation:

- modular API boundaries
- session-scoped data isolation
- DB + storage adapter split
- parser -> pipeline -> draft workflow chain

Still evolving:

- full production auth hardening
- provider abstraction expansion (beyond Gemini)
- migration strategy for production DB
- richer job/application intelligence and automation

