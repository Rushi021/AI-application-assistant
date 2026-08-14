from __future__ import annotations

from typing import Iterable, Optional, Sequence

from sqlalchemy.orm import Session

from app.common.ports import (
    ApplicationRepo,
    EmbeddingCacheRepo,
    JobRepo,
    MatchScoreRepo,
    ProfileRepo,
    RequirementRepo,
    ResumeRepo,
    ResumeSectionRepo,
    SearchTargetRepo,
    TailorRunRepo,
    UserRepo,
)
from app.modules.applications.models import Application
from app.modules.jobs.models import Job, JobRequirement
from app.modules.matching.models import EmbeddingCache, MatchScore
from app.modules.profile.models import Profile
from app.modules.resumes.models import Resume, ResumeBullet, ResumeSection
from app.modules.scraping.models import SearchTarget
from app.modules.tailoring.models import TailorRun
from app.modules.users.models import User


class SqlAlchemyUserRepo(UserRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_username(self, username: str) -> Optional[User]:
        return self._db.query(User).filter(User.username == username).first()

    def create(self, username: str) -> User:
        user = User(username=username)
        self._db.add(user)
        self._db.commit()
        self._db.refresh(user)
        return user


class SqlAlchemyResumeRepo(ResumeRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, resume: Resume) -> Resume:
        self._db.add(resume)
        self._db.commit()
        self._db.refresh(resume)
        return resume

    def list_by_user(self, user_id: int, *, active_only: bool = False) -> Iterable[Resume]:
        query = self._db.query(Resume).filter(Resume.user_id == user_id)
        if active_only:
            query = query.filter(Resume.is_active.is_(True))
        return query.order_by(Resume.family, Resume.version).all()

    def get(self, resume_id: int) -> Optional[Resume]:
        return self._db.query(Resume).filter(Resume.id == resume_id).first()

    def get_by_family_version(self, user_id: int, family: str, version: int) -> Optional[Resume]:
        return (
            self._db.query(Resume)
            .filter(Resume.user_id == user_id, Resume.family == family, Resume.version == version)
            .first()
        )

    def delete(self, resume_id: int) -> bool:
        item = self.get(resume_id)
        if not item:
            return False
        self._db.delete(item)
        self._db.commit()
        return True


class SqlAlchemyResumeSectionRepo(ResumeSectionRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def replace_for_resume(
        self, resume_id: int, sections: Sequence[ResumeSection], bullets: Sequence[ResumeBullet]
    ) -> None:
        existing = self.list_sections(resume_id)
        for section in existing:
            self._db.query(ResumeBullet).filter(ResumeBullet.section_id == section.id).delete()
            self._db.delete(section)
        self._db.flush()
        for section in sections:
            self._db.add(section)
        self._db.flush()
        for bullet in bullets:
            self._db.add(bullet)
        self._db.commit()

    def list_sections(self, resume_id: int) -> list[ResumeSection]:
        return (
            self._db.query(ResumeSection)
            .filter(ResumeSection.resume_id == resume_id)
            .order_by(ResumeSection.order_index)
            .all()
        )

    def list_bullets(self, section_id: int) -> list[ResumeBullet]:
        return (
            self._db.query(ResumeBullet)
            .filter(ResumeBullet.section_id == section_id)
            .order_by(ResumeBullet.order_index)
            .all()
        )


class SqlAlchemyJobRepo(JobRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, job: Job) -> Job:
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)
        return job

    def get(self, job_id: int) -> Optional[Job]:
        return self._db.query(Job).filter(Job.id == job_id).first()

    def list_by_user(self, user_id: int) -> Iterable[Job]:
        return self._db.query(Job).filter(Job.user_id == user_id).order_by(Job.id.desc()).all()

    def update(self, job: Job) -> Job:
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)
        return job


class SqlAlchemyRequirementRepo(RequirementRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def replace_for_job(self, job_id: int, requirements: Sequence[JobRequirement]) -> list[JobRequirement]:
        self._db.query(JobRequirement).filter(JobRequirement.job_id == job_id).delete()
        for req in requirements:
            self._db.add(req)
        self._db.commit()
        return self.list_for_job(job_id)

    def list_for_job(self, job_id: int) -> list[JobRequirement]:
        return (
            self._db.query(JobRequirement)
            .filter(JobRequirement.job_id == job_id)
            .order_by(JobRequirement.order_index)
            .all()
        )


class SqlAlchemyMatchScoreRepo(MatchScoreRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, score: MatchScore) -> MatchScore:
        self._db.add(score)
        self._db.commit()
        self._db.refresh(score)
        return score

    def list_for_job(self, job_id: int) -> list[MatchScore]:
        return (
            self._db.query(MatchScore)
            .filter(MatchScore.job_id == job_id)
            .order_by(MatchScore.total_score.desc())
            .all()
        )


class SqlAlchemyEmbeddingCacheRepo(EmbeddingCacheRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def get(self, text_sha256: str, namespace: str) -> Optional[EmbeddingCache]:
        return (
            self._db.query(EmbeddingCache)
            .filter(EmbeddingCache.text_sha256 == text_sha256, EmbeddingCache.namespace == namespace)
            .first()
        )

    def put(self, text_sha256: str, namespace: str, vector_json: str) -> EmbeddingCache:
        existing = self.get(text_sha256, namespace)
        if existing:
            existing.vector_json = vector_json
            self._db.commit()
            return existing
        row = EmbeddingCache(text_sha256=text_sha256, namespace=namespace, vector_json=vector_json)
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row


class SqlAlchemyProfileRepo(ProfileRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_user(self, user_id: int) -> Optional[Profile]:
        return self._db.query(Profile).filter(Profile.user_id == user_id).first()

    def upsert(self, profile: Profile) -> Profile:
        existing = self.get_by_user(profile.user_id)
        if existing is None:
            self._db.add(profile)
            self._db.commit()
            self._db.refresh(profile)
            return profile
        for field in (
            "full_name",
            "email",
            "phone",
            "location",
            "linkedin_url",
            "github_url",
            "website_url",
            "work_authorization",
            "needs_sponsorship",
            "address_line1",
            "city",
            "state",
            "zip_code",
            "country",
            "custom_fields_json",
            "preferred_resume_id",
        ):
            value = getattr(profile, field)
            if value is not None:
                setattr(existing, field, value)
        self._db.commit()
        self._db.refresh(existing)
        return existing


class SqlAlchemyTailorRunRepo(TailorRunRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, run: TailorRun) -> TailorRun:
        self._db.add(run)
        self._db.commit()
        self._db.refresh(run)
        return run

    def get(self, run_id: int) -> Optional[TailorRun]:
        return self._db.query(TailorRun).filter(TailorRun.id == run_id).first()

    def update(self, run: TailorRun) -> TailorRun:
        self._db.add(run)
        self._db.commit()
        self._db.refresh(run)
        return run


class SqlAlchemyApplicationRepo(ApplicationRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, application: Application) -> Application:
        self._db.add(application)
        self._db.commit()
        self._db.refresh(application)
        return application

    def get(self, application_id: int) -> Optional[Application]:
        return self._db.query(Application).filter(Application.id == application_id).first()

    def list_by_user(self, user_id: int) -> Iterable[Application]:
        return (
            self._db.query(Application)
            .filter(Application.user_id == user_id)
            .order_by(Application.id.desc())
            .all()
        )

    def update(self, application: Application) -> Application:
        self._db.add(application)
        self._db.commit()
        self._db.refresh(application)
        return application

    def update_status(self, application_id: int, status: str) -> Optional[Application]:
        application = self.get(application_id)
        if not application:
            return None
        application.status = status
        return self.update(application)


class SqlAlchemySearchTargetRepo(SearchTargetRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, target: SearchTarget) -> SearchTarget:
        self._db.add(target)
        self._db.commit()
        self._db.refresh(target)
        return target

    def list_by_user(self, user_id: int) -> Iterable[SearchTarget]:
        return self._db.query(SearchTarget).filter(SearchTarget.user_id == user_id).all()
