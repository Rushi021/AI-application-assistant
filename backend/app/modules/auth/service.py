from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyUserRepo
from app.core.config import get_settings
from app.core.security import TestUser


def get_or_create_test_user(db: Session) -> TestUser:
    settings = get_settings()
    repo = SqlAlchemyUserRepo(db)
    user = repo.get_by_username(settings.test_username)
    if not user:
        user = repo.create(settings.test_username)
    return TestUser(id=user.id, username=user.username)
