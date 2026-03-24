# Backend (AI Job Application Assistant)

## Setup

1. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   .\venv\Scripts\Activate.ps1   # Windows
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run database migrations** (required; the app expects `resume_drafts.cover_letter` and `resume_draft_sections.section_group`):
   ```bash
   alembic upgrade head
   ```
   If you see "API 500" or "no such column" errors when using the extension, run this from the `backend` folder.

4. Configure `.env` (see `.env.example`).

5. Start the API:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

## Access Control and Admin

- Google login is now whitelist-based: `/auth/google` only allows users that already exist in `users` and have `is_active=true`.
- Admin users are controlled via `users.is_admin=true` and can manage users and behavior logs through `/admin/*` APIs.
- Bootstrap the first admin with `ADMIN_EMAILS` in `.env` (comma-separated emails). When that user logs in, admin access is auto-enabled.

## Streamlit Web OAuth

- Start Google OAuth: `GET /auth/web/google/start`
- OAuth callback: `GET /auth/web/google/callback`
- Exchange one-time code for JWT: `POST /auth/web/exchange`

The backend never places JWTs in query strings; callbacks use short-lived one-time login codes.

## Why migrations matter

The code and database schema must stay in sync. New columns (e.g. `cover_letter`, `section_group`) are added via Alembic migrations. If you skip `alembic upgrade head`, the ORM will request columns that do not exist and the server will return 500 errors. Running migrations is the correct, permanent fix—no workarounds required.
