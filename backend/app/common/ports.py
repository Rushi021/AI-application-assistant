from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterable, Optional

from app.modules.applications.models import Application


class LLMProvider(ABC):
    """Port for LLM calls; swap provider (Gemini, OpenAI, etc.) via adapters."""

    @abstractmethod
    def generate(self, prompt: str, **kwargs: object) -> str:
        raise NotImplementedError


from app.modules.jobs.models import Job
from app.modules.pipeline.models import PipelineRun
from app.modules.resumes.models import Resume
from app.modules.users.models import User


class ResumeStorage(ABC):
    @abstractmethod
    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_file_url_or_path(self, file_key: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_file_bytes(self, file_key: str) -> bytes:
        """Return raw file bytes for the given file_key (e.g. for parsing docx)."""
        raise NotImplementedError

    @abstractmethod
    def delete_file(self, file_key: str) -> None:
        raise NotImplementedError


class UserRepo(ABC):
    @abstractmethod
    def get_by_username(self, username: str) -> Optional[User]:
        raise NotImplementedError

    @abstractmethod
    def create(self, username: str) -> User:
        raise NotImplementedError


class ResumeRepo(ABC):
    @abstractmethod
    def create(self, resume: Resume) -> Resume:
        raise NotImplementedError

    @abstractmethod
    def list_by_user(self, user_id: int) -> Iterable[Resume]:
        raise NotImplementedError

    @abstractmethod
    def get(self, resume_id: int) -> Optional[Resume]:
        raise NotImplementedError


class JobRepo(ABC):
    @abstractmethod
    def create(self, job: Job) -> Job:
        raise NotImplementedError


class PipelineRunRepo(ABC):
    @abstractmethod
    def create(self, run: PipelineRun) -> PipelineRun:
        raise NotImplementedError

    @abstractmethod
    def get(self, run_id: int) -> Optional[PipelineRun]:
        raise NotImplementedError

    @abstractmethod
    def update_results(
        self,
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
    def list_by_user(self, user_id: int) -> Iterable[Application]:
        raise NotImplementedError

    @abstractmethod
    def update_status(self, application_id: int, status: str) -> Optional[Application]:
        raise NotImplementedError
