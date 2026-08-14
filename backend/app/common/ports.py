"""Ports for storage, scraping, rendering, and repositories.

Model ports live in `app.modules.ai.ports` so nothing outside `ai/` names a provider.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from app.modules.applications.models import Application
from app.modules.jobs.models import Job, JobRequirement
from app.modules.matching.models import EmbeddingCache, MatchScore
from app.modules.profile.models import Profile
from app.modules.resumes.models import Resume, ResumeBullet, ResumeSection
from app.modules.scraping.models import SearchTarget
from app.modules.tailoring.models import TailorRun
from app.modules.users.models import User


class ResumeStorage(ABC):
    @abstractmethod
    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_file_url_or_path(self, file_key: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def delete_file(self, file_key: str) -> None:
        raise NotImplementedError


@dataclass
class ScrapedJob:
    raw_text: str
    company_name: Optional[str] = None
    role: Optional[str] = None
    sponsorship: Optional[str] = None
    date_posted: Optional[str] = None
    application_link: Optional[str] = None


class JobBoardScraper(ABC):
    provider_name: str = "unknown"

    @abstractmethod
    def search(self, role: str, location: str = "", keywords: str = "") -> list[ScrapedJob]:
        raise NotImplementedError


@dataclass
class RenderResult:
    tex_path: str
    pdf_path: Optional[str]
    compiler: Optional[str]
    warning: Optional[str] = None


class DocumentRenderer(ABC):
    @abstractmethod
    def render(self, latex: str, output_stem: str) -> RenderResult:
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
    def list_by_user(self, user_id: int, *, active_only: bool = False) -> Iterable[Resume]:
        raise NotImplementedError

    @abstractmethod
    def get(self, resume_id: int) -> Optional[Resume]:
        raise NotImplementedError

    @abstractmethod
    def get_by_family_version(self, user_id: int, family: str, version: int) -> Optional[Resume]:
        raise NotImplementedError

    @abstractmethod
    def delete(self, resume_id: int) -> bool:
        raise NotImplementedError


class ResumeSectionRepo(ABC):
    @abstractmethod
    def replace_for_resume(
        self, resume_id: int, sections: Sequence[ResumeSection], bullets: Sequence[ResumeBullet]
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_sections(self, resume_id: int) -> list[ResumeSection]:
        raise NotImplementedError

    @abstractmethod
    def list_bullets(self, section_id: int) -> list[ResumeBullet]:
        raise NotImplementedError


class JobRepo(ABC):
    @abstractmethod
    def create(self, job: Job) -> Job:
        raise NotImplementedError

    @abstractmethod
    def get(self, job_id: int) -> Optional[Job]:
        raise NotImplementedError

    @abstractmethod
    def list_by_user(self, user_id: int) -> Iterable[Job]:
        raise NotImplementedError

    @abstractmethod
    def update(self, job: Job) -> Job:
        raise NotImplementedError


class RequirementRepo(ABC):
    @abstractmethod
    def replace_for_job(self, job_id: int, requirements: Sequence[JobRequirement]) -> list[JobRequirement]:
        raise NotImplementedError

    @abstractmethod
    def list_for_job(self, job_id: int) -> list[JobRequirement]:
        raise NotImplementedError


class MatchScoreRepo(ABC):
    @abstractmethod
    def create(self, score: MatchScore) -> MatchScore:
        raise NotImplementedError

    @abstractmethod
    def list_for_job(self, job_id: int) -> list[MatchScore]:
        raise NotImplementedError


class EmbeddingCacheRepo(ABC):
    @abstractmethod
    def get(self, text_sha256: str, namespace: str) -> Optional[EmbeddingCache]:
        raise NotImplementedError

    @abstractmethod
    def put(self, text_sha256: str, namespace: str, vector_json: str) -> EmbeddingCache:
        raise NotImplementedError


class ProfileRepo(ABC):
    @abstractmethod
    def get_by_user(self, user_id: int) -> Optional[Profile]:
        raise NotImplementedError

    @abstractmethod
    def upsert(self, profile: Profile) -> Profile:
        raise NotImplementedError


class TailorRunRepo(ABC):
    @abstractmethod
    def create(self, run: TailorRun) -> TailorRun:
        raise NotImplementedError

    @abstractmethod
    def get(self, run_id: int) -> Optional[TailorRun]:
        raise NotImplementedError

    @abstractmethod
    def update(self, run: TailorRun) -> TailorRun:
        raise NotImplementedError


class ApplicationRepo(ABC):
    @abstractmethod
    def create(self, application: Application) -> Application:
        raise NotImplementedError

    @abstractmethod
    def get(self, application_id: int) -> Optional[Application]:
        raise NotImplementedError

    @abstractmethod
    def list_by_user(self, user_id: int) -> Iterable[Application]:
        raise NotImplementedError

    @abstractmethod
    def update(self, application: Application) -> Application:
        raise NotImplementedError


class SearchTargetRepo(ABC):
    @abstractmethod
    def create(self, target: SearchTarget) -> SearchTarget:
        raise NotImplementedError

    @abstractmethod
    def list_by_user(self, user_id: int) -> Iterable[SearchTarget]:
        raise NotImplementedError
