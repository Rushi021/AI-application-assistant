from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.common.ports import (
    ApplicationRepo,
    JobRepo,
    PipelineRunRepo,
    ResumeRepo,
    UserRepo,
)
from app.modules.applications.models import Application
from app.modules.jobs.models import Job
from app.modules.pipeline.models import PipelineRun
from app.modules.resumes.models import Resume
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

    def list_by_user(self, user_id: int) -> Iterable[Resume]:
        return self._db.query(Resume).filter(Resume.user_id == user_id).all()

    def get(self, resume_id: int) -> Optional[Resume]:
        return self._db.query(Resume).filter(Resume.id == resume_id).first()


class SqlAlchemyJobRepo(JobRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, job: Job) -> Job:
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)
        return job


class SqlAlchemyPipelineRunRepo(PipelineRunRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, run: PipelineRun) -> PipelineRun:
        self._db.add(run)
        self._db.commit()
        self._db.refresh(run)
        return run

    def get(self, run_id: int) -> Optional[PipelineRun]:
        return self._db.query(PipelineRun).filter(PipelineRun.id == run_id).first()


class SqlAlchemyApplicationRepo(ApplicationRepo):
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, application: Application) -> Application:
        self._db.add(application)
        self._db.commit()
        self._db.refresh(application)
        return application

    def list_by_user(self, user_id: int) -> Iterable[Application]:
        return self._db.query(Application).filter(Application.user_id == user_id).all()

    def update_status(self, application_id: int, status: str) -> Optional[Application]:
        application = self._db.query(Application).filter(Application.id == application_id).first()
        if not application:
            return None
        application.status = status
        self._db.commit()
        self._db.refresh(application)
        return application
