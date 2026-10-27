from contextlib import asynccontextmanager
import threading

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core.logging import setup_logging
from app.db.base import Base
from app.db import session as db_session
from app.modules.ai.router import router as models_router
from app.modules.applications.router import router as applications_router
from app.modules.auth.router import router as auth_router
from app.modules.jobs.router import router as jobs_router
from app.modules.agent.router import router as agent_router
from app.core.config import get_settings
from app.modules.matching.router import router as matching_router
from app.modules.profile.router import router as profile_router
from app.modules.resumes.router import router as resumes_router
from app.modules.scraping.router import router as scraping_router
from app.modules.tailoring.router import router as tailoring_router

# Register model adapters (decorator side effects) and ORM tables.
import app.modules.ai.providers  # noqa: F401
from app.modules.ai import usage as _usage_models  # noqa: F401
from app.modules.applications.models import APPLICATION_SQLITE_COLUMNS
from app.modules.jobs import models as _job_models  # noqa: F401
from app.modules.matching import models as _matching_models  # noqa: F401
from app.modules.profile.models import PROFILE_SQLITE_COLUMNS
from app.modules.resumes import models as _resume_models  # noqa: F401
from app.modules.scraping import models as _scraping_models  # noqa: F401
from app.modules.tailoring.models import TAILOR_RUN_SQLITE_COLUMNS
from app.modules.users import models as _user_models  # noqa: F401

WEB_DIR = Path(__file__).resolve().parent / "web"


def _patch_sqlite_columns() -> None:
    """Add columns introduced after the first create_all on an existing local DB."""
    url = str(db_session.engine.url)
    if not url.startswith("sqlite"):
        return
    additions = {
        "agent_plans": {"run_once": "BOOLEAN NOT NULL DEFAULT 0"},
        "profiles": PROFILE_SQLITE_COLUMNS,
        "tailor_runs": TAILOR_RUN_SQLITE_COLUMNS,
        "applications": APPLICATION_SQLITE_COLUMNS,
    }
    with db_session.engine.begin() as conn:
        for table, columns in additions.items():
            exists = conn.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=:table"
                ),
                {"table": table},
            )
            if exists.fetchone() is None:
                continue
            present = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            for name, sql_type in columns.items():
                if name not in present:
                    conn.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}")
                    )


@asynccontextmanager
async def lifespan(app):
    stop = threading.Event()
    worker = None
    if get_settings().agent_worker_enabled:
        from app.modules.agent.worker import loop

        worker = threading.Thread(
            target=loop, args=(stop,), daemon=True, name="application-agent"
        )
        worker.start()
    yield
    stop.set()
    if worker:
        worker.join(timeout=2)


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(title="AI Job Application Assistant", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
        allow_origin_regex=r"chrome-extension://[a-p]{32}",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    Base.metadata.create_all(bind=db_session.engine)
    _patch_sqlite_columns()

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(agent_router)
    app.include_router(auth_router)
    app.include_router(models_router)
    app.include_router(resumes_router)
    app.include_router(jobs_router)
    app.include_router(matching_router)
    app.include_router(tailoring_router)
    app.include_router(applications_router)
    app.include_router(profile_router)
    app.include_router(scraping_router)

    if WEB_DIR.exists():
        app.mount("/web", StaticFiles(directory=WEB_DIR), name="web")

        @app.get("/", include_in_schema=False)
        def web_home():
            return FileResponse(WEB_DIR / "index.html")

    return app


app = create_app()
