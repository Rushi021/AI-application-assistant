"""
Port interfaces (abstract repos + services).

ALL repo methods that read/write user-owned data MUST accept a session_id
(or RequestScope) and scope queries by it. No unscoped reads are allowed.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterable, Optional

from app.modules.applications.models import Application, ApplicationEvent
from app.modules.jobs.models import Job
from app.modules.pipeline.models import PipelineRun
from app.modules.resumes.models import Resume
from app.modules.users.models import User


# ---------------------------------------------------------------------------
# LLM provider (not user-scoped; stateless)
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """Port for LLM calls; swap provider (Gemini, OpenAI, etc.) via adapters."""

    @abstractmethod
    def generate(self, prompt: str, **kwargs: object) -> str:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# File storage (not user-scoped; keyed by opaque file_key)
# ---------------------------------------------------------------------------

class ResumeStorage(ABC):
    @abstractmethod
    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_file_url_or_path(self, file_key: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_file_bytes(self, file_key: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    def delete_file(self, file_key: str) -> None:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# User repo (system-level; not session-scoped)
# ---------------------------------------------------------------------------

class UserRepo(ABC):
    @abstractmethod
    def get_by_username(self, username: str) -> Optional[User]:
        raise NotImplementedError

    @abstractmethod
    def create(self, username: str) -> User:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Session-scoped repos (every query filtered by session_id)
# ---------------------------------------------------------------------------

class ResumeRepo(ABC):
    @abstractmethod
    def create(self, resume: Resume) -> Resume:
        raise NotImplementedError

    @abstractmethod
    def list_by_session(self, session_id: str) -> Iterable[Resume]:
        raise NotImplementedError

    @abstractmethod
    def get_by_scope(self, session_id: str, resume_id: int) -> Optional[Resume]:
        raise NotImplementedError

    @abstractmethod
    def count_by_session(self, session_id: str) -> int:
        raise NotImplementedError


class JobRepo(ABC):
    @abstractmethod
    def create(self, job: Job) -> Job:
        raise NotImplementedError

    @abstractmethod
    def get_by_scope(self, session_id: str, job_id: int) -> Optional[Job]:
        raise NotImplementedError


class PipelineRunRepo(ABC):
    @abstractmethod
    def create(self, run: PipelineRun) -> PipelineRun:
        raise NotImplementedError

    @abstractmethod
    def get_by_scope(self, session_id: str, run_id: int) -> Optional[PipelineRun]:
        raise NotImplementedError

    @abstractmethod
    def list_by_session(self, session_id: str) -> Iterable[PipelineRun]:
        raise NotImplementedError

    @abstractmethod
    def update_results(
        self,
        session_id: str,
        run_id: int,
        *,
        status: str,
        tailored_resume: Optional[str] = None,
        tailored_sections: Optional[str] = None,
        cover_letter: Optional[str] = None,
    ) -> Optional[PipelineRun]:
        raise NotImplementedError


class ApplicationRepo(ABC):
    @abstractmethod
    def create(self, application: Application) -> Application:
        raise NotImplementedError

    @abstractmethod
    def list_by_session(self, session_id: str) -> Iterable[Application]:
        raise NotImplementedError

    @abstractmethod
    def get_by_scope(self, session_id: str, application_id: int) -> Optional[Application]:
        raise NotImplementedError

    @abstractmethod
    def update_status(self, session_id: str, application_id: int, status: str) -> Optional[Application]:
        raise NotImplementedError


class ApplicationEventRepo(ABC):
    @abstractmethod
    def create(self, event: ApplicationEvent) -> ApplicationEvent:
        raise NotImplementedError

    @abstractmethod
    def list_by_application(self, session_id: str, application_id: int) -> Iterable[ApplicationEvent]:
        raise NotImplementedError
