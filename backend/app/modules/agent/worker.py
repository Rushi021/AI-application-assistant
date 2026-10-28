"""Run with python -m app.modules.agent.worker, or the API lifespan worker.

Keep the backend running to prepare packets while the UI is closed. DB leases
serialize discovery across workers. Browser submissions run only in the extension.
"""

import logging
import threading
from sqlalchemy import select, or_
from app.db import session
from app.modules.agent.models import AgentPlan
from app.modules.agent.service import run_plan
from app.modules.ai.gateway import ModelGateway
from app.modules.ai.usage import SqlAlchemyUsageLogger

log = logging.getLogger(__name__)


def tick():
    with session.SessionLocal() as db:
        ids = db.scalars(
            select(AgentPlan.id).where(
                or_(AgentPlan.enabled.is_(True), AgentPlan.run_once.is_(True))
            )
        ).all()
    for plan_id in ids:
        with session.SessionLocal() as db:
            run_plan(db, plan_id, ModelGateway(usage=SqlAlchemyUsageLogger()))


def loop(stop):
    while not stop.is_set():
        try:
            tick()
        except Exception:
            log.exception("Agent worker tick failed")
        stop.wait(10)


if __name__ == "__main__":
    from app.main import app  # noqa: F401 - register tables/providers without starting lifespan

    try:
        loop(threading.Event())
    except KeyboardInterrupt:
        pass
