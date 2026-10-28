from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from app.modules.agent.discovery import canonical
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import (
    SqlAlchemyJobRepo,
    SqlAlchemySearchTargetRepo,
)
from app.common.ports import JobBoardScraper
from app.core.deps import get_current_user, get_db
from app.modules.jobs.models import Job
from app.modules.scraping.adapter import get_scraper
from app.modules.scraping.models import SearchTarget
from app.modules.scraping.schemas import (
    ScrapeSearchRequest,
    ScrapeSearchResponse,
    ScrapedJobRead,
    SearchTargetCreate,
    SearchTargetRead,
)

router = APIRouter(prefix="/scraping", tags=["scraping"])


@router.post("/targets", response_model=SearchTargetRead)
def create_target(
    payload: SearchTargetCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchTargetRead:
    target = SearchTarget(user_id=current_user.id, **payload.model_dump())
    created = SqlAlchemySearchTargetRepo(db).create(target)
    return SearchTargetRead.model_validate(created)


@router.get("/targets", response_model=list[SearchTargetRead])
def list_targets(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SearchTargetRead]:
    items = SqlAlchemySearchTargetRepo(db).list_by_user(current_user.id)
    return [SearchTargetRead.model_validate(item) for item in items]


@router.post("/search", response_model=ScrapeSearchResponse)
def search_jobs(
    payload: ScrapeSearchRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    scraper: JobBoardScraper = Depends(get_scraper),
) -> ScrapeSearchResponse:
    results: list[ScrapedJobRead] = []
    job_repo = SqlAlchemyJobRepo(db)
    keywords = ", ".join(payload.keywords)
    for role in payload.roles:
        for location in payload.locations:
            try:
                matches = scraper.search(role, location, keywords)
            except Exception as exc:
                raise HTTPException(
                    502,
                    f"Job source unavailable ({type(exc).__name__}). Check provider configuration or use another source in Agent settings.",
                )
            for item in matches:
                job_id = None
                if payload.persist:
                    url = (
                        canonical(item.application_link)
                        if item.application_link
                        else None
                    )
                    existing = (
                        db.scalar(
                            select(Job).where(
                                Job.user_id == current_user.id,
                                Job.application_link == url,
                            )
                        )
                        if url
                        else None
                    )
                    job = existing or job_repo.create(
                        Job(
                            user_id=current_user.id,
                            raw_text=item.raw_text,
                            company_name=item.company_name,
                            role=item.role or role,
                            sponsorship=item.sponsorship,
                            date_posted=item.date_posted,
                            application_link=url,
                            source="scraped",
                        )
                    )
                    job_id = job.id
                results.append(
                    ScrapedJobRead(
                        raw_text=item.raw_text,
                        company_name=item.company_name,
                        role=item.role,
                        sponsorship=item.sponsorship,
                        date_posted=item.date_posted,
                        application_link=item.application_link,
                        job_id=job_id,
                    )
                )
    return ScrapeSearchResponse(provider=scraper.provider_name, results=results)
