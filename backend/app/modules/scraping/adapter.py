"""Legacy manual search delegates to the same real discovery providers as Agent."""

from app.common.ports import JobBoardScraper, ScrapedJob
from app.core.config import get_settings
from app.modules.agent.discovery import JobDiscovery
from app.modules.agent.schemas import Source


class NoopJobBoardScraper(JobBoardScraper):
    provider_name = "noop"

    def search(self, role, location="", keywords=""):
        return []


class PublicJobBoardScraper(JobBoardScraper):
    provider_name = "public"

    def search(self, role, location="", keywords=""):
        discovery = JobDiscovery()
        try:
            provider = "google_jobs" if get_settings().serpapi_api_key else "remotive"
            rows = discovery.fetch(Source(provider=provider), role, location)
            return [
                ScrapedJob(
                    raw_text=p.description,
                    company_name=p.company,
                    role=p.title,
                    date_posted=p.published,
                    application_link=p.url,
                )
                for p in rows
                if not location
                or location.lower() in {"any", "anywhere", "remote"}
                or location.casefold() in p.location.casefold()
            ]
        finally:
            discovery.close()


def get_scraper():
    provider = get_settings().scraper_provider
    if provider == "noop":
        return NoopJobBoardScraper()
    if provider == "public":
        return PublicJobBoardScraper()
    raise ValueError("Unknown SCRAPER_PROVIDER; choose public or noop")
