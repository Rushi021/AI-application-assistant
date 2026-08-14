from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings


def _make_engine(url: str) -> Engine:
    return create_engine(
        url,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
    )


settings = get_settings()
engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def configure_engine(url: str) -> Engine:
    """Rebuild the module-level engine. Used by tests to point at a temp SQLite file."""
    global engine, SessionLocal
    engine = _make_engine(url)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine
