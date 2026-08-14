# AI Job Application Assistant

Backend + Chrome extension that takes a pasted job description, scores it against versioned LaTeX base resumes (keyword match, then embeddings on misses), optionally tailors with an LLM, and logs the application outcome.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything.** It is the source of truth for scoring tiers, the swappable model layer, data model, and placeholders.

## Layout

```
backend/     FastAPI modular monolith
extension/   Vanilla MV3 Chrome extension (no build step)
```

## Quick start

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # set GOOGLE_AI_API_KEY for real Gemini calls
uvicorn app.main:app --reload
```

On this Mac there is no `python` binary — use `python3` (Homebrew 3.12 is preferred). The module is `venv`, and `.venv` is the folder name, so the command is `python3 -m venv .venv`, not `python -m .venv`.

Load `extension/` as an unpacked extension at `chrome://extensions`. Open the web packet at [http://localhost:8000/](http://localhost:8000/) — Personal information, Job search, Resume store, and Tracker. Autofill reads the personal-information page; you choose which resume to apply with.

Offline / tests (no vendor APIs):

```
LLM_DEFAULT=fake:fake
LLM_RESUME_TAILOR=fake:fake
EMBEDDING_DEFAULT=fake:fake
pytest
```

## Design in one paragraph

Callers never name a model. They call `ModelGateway` with a task (`jd_extraction`, `resume_tailor`, `requirement_embedding`, …). Config maps each task to `provider:model`. Tier 0 uses the LLM only to extract must-have vs nice-to-have requirements. Tier 1 is exact keyword match. Tier 2 embeddings run only on tier-1 misses. Web scraping and page capture are wired placeholders.

## Auth (dev only)

`POST /auth/login` with `testuser` / `testpass` → bearer `test-token`. Replace before any real deployment.
