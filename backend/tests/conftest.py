from __future__ import annotations

import os

os.environ["LLM_DEFAULT"] = "fake:fake"
os.environ["LLM_JD_EXTRACTION"] = "fake:fake"
os.environ["LLM_RESUME_TAILOR"] = "fake:fake"
os.environ["LLM_BULLET_REWRITE"] = "fake:fake"
os.environ["LLM_COVER_LETTER"] = "fake:fake"
os.environ["EMBEDDING_DEFAULT"] = "fake:fake"
os.environ["EMBEDDING_REQUIREMENT"] = "fake:fake"
os.environ["EMBEDDING_RESUME"] = "fake:fake"

import pytest
from fastapi.testclient import TestClient

from app.modules.ai import providers as _providers  # noqa: F401


SAMPLE_TEX = r"""
\documentclass{article}
\begin{document}
\section{Experience}
\begin{itemize}
\item Built Python APIs for image classification on medical scans
\item Deployed Kubernetes services on AWS
\end{itemize}
\section{Skills}
Python, SQL, machine learning
\end{document}
"""

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("LOCAL_STORAGE_PATH", str(tmp_path / "resumes"))
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path / "output"))
    monkeypatch.setenv("LLM_DEFAULT", "fake:fake")
    monkeypatch.setenv("LLM_RESUME_TAILOR", "fake:fake")
    monkeypatch.setenv("EMBEDDING_DEFAULT", "fake:fake")

    from app.core.config import get_settings
    from app.modules.ai.gateway import reset_shared_gateway

    get_settings.cache_clear()
    reset_shared_gateway()

    from app.db.session import configure_engine
    from app.db.base import Base

    engine = configure_engine(f"sqlite:///{db_path}")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
