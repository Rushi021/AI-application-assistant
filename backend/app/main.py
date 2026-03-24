from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.base import Base
from app.db.session import engine
from app.modules.auth.router import router as auth_router
from app.modules.admin.router import router as admin_router
from app.modules.users.router import router as users_router
from app.modules.resumes.router import router as resumes_router
from app.modules.jobs.router import router as jobs_router
from app.modules.pipeline.router import router as pipeline_router
from app.modules.applications.router import router as applications_router
from app.modules.drafts.router import router as drafts_router
from app.modules.me.router import router as me_router

# Import models so create_all sees them
from app.modules.users import models as _user_models  # noqa: F401
from app.modules.resumes import models as _resume_models  # noqa: F401
from app.modules.jobs import models as _job_models  # noqa: F401
from app.modules.pipeline import models as _pipeline_models  # noqa: F401
from app.modules.applications import models as _application_models  # noqa: F401
from app.modules.drafts import models as _draft_models  # noqa: F401
from app.modules.auth import models as _auth_models  # noqa: F401


class ChromeExtensionCORSMiddleware(BaseHTTPMiddleware):
    def _cors_headers(self, origin: str) -> dict[str, str]:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Id",
        }

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin", "")
        if origin.startswith("chrome-extension://") and request.method == "OPTIONS":
            return Response(status_code=200, headers=self._cors_headers(origin))

        response = await call_next(request)
        if origin.startswith("chrome-extension://"):
            for header, value in self._cors_headers(origin).items():
                response.headers[header] = value
        return response


def create_app() -> FastAPI:
    setup_logging()
    settings = get_settings()
    settings.validate_startup_requirements()

    app = FastAPI(title="AI Job Application Assistant")

    app.add_middleware(ChromeExtensionCORSMiddleware)

    # CORS: allow configured web origins; extension origins handled by custom middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
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
    app.include_router(admin_router)
    app.include_router(users_router)
    app.include_router(resumes_router)
    app.include_router(jobs_router)
    app.include_router(pipeline_router)
    app.include_router(applications_router)
    app.include_router(drafts_router)
    app.include_router(me_router)
    return app


app = create_app()
