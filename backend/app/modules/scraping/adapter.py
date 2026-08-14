from app.common.ports import JobBoardScraper, ScrapedJob
from app.core.config import get_settings


class NoopJobBoardScraper(JobBoardScraper):
    """Placeholder. Search is wired end-to-end; only this adapter needs filling in later."""

    provider_name = "noop"

    def search(self, role: str, location: str = "", keywords: str = "") -> list[ScrapedJob]:
        return []


def get_scraper() -> JobBoardScraper:
    provider = get_settings().scraper_provider
    if provider == "noop":
        return NoopJobBoardScraper()
    # Unknown names still fall back to the placeholder rather than crashing the API.
    return NoopJobBoardScraper()
