from fastapi import FastAPI

from app.core.logging import setup_logging
from app.db.base import Base
from app.db.session import engine
from app.modules.auth.router import router as auth_router
from app.modules.resumes.router import router as resumes_router
from app.modules.jobs.router import router as jobs_router
from app.modules.pipeline.router import router as pipeline_router
from app.modules.applications.router import router as applications_router
from app.modules.users import models as _user_models
from app.modules.resumes import models as _resume_models
from app.modules.jobs import models as _job_models
from app.modules.pipeline import models as _pipeline_models
from app.modules.applications import models as _application_models


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(title="AI Job Application Assistant")

    Base.metadata.create_all(bind=engine)

    @app.get("/")
    def root() -> dict:
        return {
            "app": "AI Job Application Assistant",
            "docs": "/docs",
            "health": "/health",
            "openapi": "/openapi.json",
        }

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(resumes_router)
    app.include_router(jobs_router)
    app.include_router(pipeline_router)
    app.include_router(applications_router)
    return app


app = create_app()
