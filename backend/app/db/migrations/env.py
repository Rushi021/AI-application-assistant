import sys
from pathlib import Path
from logging.config import fileConfig

# Ensure backend root is on path so "app" can be imported when running alembic from backend
_backend_root = Path(__file__).resolve().parents[3]
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.db.base import Base
from app.modules.auth.models import WebLoginCode
from app.modules.applications.models import Application, ApplicationEvent
from app.modules.drafts.models import ResumeDraft, ResumeDraftSection, SectionChatMessage
from app.modules.jobs.models import Job
from app.modules.pipeline.models import PipelineRun
from app.modules.resumes.models import Resume
from app.modules.users.models import User

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
