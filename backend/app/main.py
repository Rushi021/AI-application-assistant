from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.base import Base
from app.db.session import engine
from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router
from app.modules.resumes.router import router as resumes_router
from app.modules.jobs.router import router as jobs_router
from app.modules.pipeline.router import router as pipeline_router
from app.modules.applications.router import router as applications_router
from app.modules.drafts.router import router as drafts_router

# Import models so create_all sees them
from app.modules.users import models as _user_models  # noqa: F401
from app.modules.resumes import models as _resume_models  # noqa: F401
from app.modules.jobs import models as _job_models  # noqa: F401
from app.modules.pipeline import models as _pipeline_models  # noqa: F401
from app.modules.applications import models as _application_models  # noqa: F401
from app.modules.drafts import models as _draft_models  # noqa: F401


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(title="AI Job Application Assistant")

    # CORS: allow localhost + Chrome extension origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Tighten in production to specific chrome-extension:// origins
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    Base.metadata.create_all(bind=engine)

    @app.get("/")
    def root() -> dict:
        return {
            "app": "AI Job Application Assistant",
            "docs": "/docs",
            "health": "/health",
        }

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(resumes_router)
    app.include_router(jobs_router)
    app.include_router(pipeline_router)
    app.include_router(applications_router)
    app.include_router(drafts_router)
    return app


app = create_app()
