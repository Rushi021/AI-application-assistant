# AI Job Application Assistant — Backend Foundation

This repository also includes a **Chrome extension** (`chrome-extension/`) and optional **Streamlit** demo client (`streamlit_app/`) in addition to the backend described below. For a full repo map, extension autofill behavior, and build commands, see **[AGENT.md](AGENT.md)** and **[implementation.md](implementation.md)**.

---

This document focuses on the modular **FastAPI backend** designed to start with local-only development (hardcoded test auth + local file storage) and later swap to AWS (RDS Postgres + S3) with minimal refactor. The code follows a **ports and adapters** style so storage and database layers remain swappable.

## What This Provides (MVP)
- Working FastAPI server with a clean, modular monolith structure.
- Hardcoded test-only login + token for local development.
- SQLite database for metadata storage.
- Local filesystem storage for resume files.
- Clear interfaces for repositories and storage to enable future AWS swap.

## Project Structure (Evolving)

```
backend/
  app/
    main.py
    core/
      config.py
      logging.py
      security.py
      deps.py
    db/
      session.py
      base.py
      migrations/   (alembic)
    modules/
      auth/
        router.py
        service.py
        models.py
        schemas.py
      users/
        models.py
        schemas.py
      resumes/
        router.py
        models.py
        schemas.py
      jobs/
        router.py
        models.py
        schemas.py
      pipeline/
        router.py
        models.py
        schemas.py
      applications/
        router.py
        models.py
        schemas.py
      ai/
        router.py
        orchestrator.py
        providers/
          openai_provider.py
          gemini_provider.py
        prompts/
        schemas.py
      chat/
    common/
      ports.py
      adapters/
        local_storage.py
        s3_storage.py
        sqlalchemy_repos.py
      errors.py
      utils.py
  tests/
  alembic.ini
  docker-compose.yml
  Dockerfile
```

## Key Design Decisions

### Ports and Adapters (Storage + DB)
- `ResumeStorage` is a **port** that defines the storage contract.
- `LocalResumeStorage` is the **current adapter** (local filesystem).
- `S3ResumeStorage` is a **stub adapter** for future AWS migration.
- Database access goes through repository interfaces:
  - `UserRepo`, `ResumeRepo`, `JobRepo`, `PipelineRunRepo`, `ApplicationRepo`
  - `SqlAlchemy*Repo` are the current adapters.

### Swapping Local → AWS Later
| Layer | MVP | Future |
|------|-----|--------|
| DB | SQLite | Postgres (RDS) |
| File storage | Local filesystem | S3 |
| Auth | Hardcoded token | JWT + hashed passwords |

The interfaces remain stable; only adapters and config change.

## API Endpoints (MVP)
- `GET /health`
- `POST /auth/login` (test-only)
- `GET /auth/me` (test-only)
- `POST /resumes/upload`
- `GET /resumes`
- `GET /resumes/{id}`
- `POST /jobs/ingest`
- `POST /pipeline/run`
- `GET /pipeline/runs/{run_id}`
- `POST /applications`
- `PATCH /applications/{id}`
- `GET /applications`

## Local Setup

1) Create and activate a venv  
2) Install dependencies  

```
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

3) Create a `.env` (copy from `.env.example`)

```
copy .env.example .env
```

4) Run the API

```
uvicorn app.main:app --reload
```

## Environment Variables

```
APP_NAME
ENVIRONMENT
DATABASE_URL
STORAGE_BACKEND
LOCAL_STORAGE_PATH
MAX_UPLOAD_SIZE_MB
ALLOWED_EXTENSIONS
TEST_USERNAME
TEST_PASSWORD
TEST_TOKEN
```

## Notes
- Auth is **test-only** and must be replaced for production.
- File content is stored in the filesystem; DB stores metadata only.
- Alembic is scaffolded; migrations can be added later.

---

If you want next steps, I can:
- Add initial Alembic migration scripts
- Add tests for core endpoints
- Add AWS-ready adapters (S3 + Postgres) when you’re ready
