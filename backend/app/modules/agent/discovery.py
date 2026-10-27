"""Public job-board connectors. No authenticated-page scraping or credential storage.

Each connector reports failure independently. Fixed API hosts and slug-only boards
prevent user-provided source configuration from becoming an arbitrary URL fetcher.
"""

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
import hashlib
import ipaddress
import re
import time
import httpx
from app.core.config import get_settings
from app.modules.agent.schemas import Source, PlanConfig


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value):
    p = Text()
    p.feed(unescape(value or ""))
    return " ".join(p.parts).strip()


def canonical(url: str) -> str:
    p = urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("Applications require an HTTPS URL without credentials")
    hostname = p.hostname.lower()
    if (
        hostname == "localhost"
        or hostname.endswith((".localhost", ".local", ".internal"))
        or "." not in hostname
    ):
        raise ValueError("Application destination must be a public hostname")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("Application destination must be public")
    query = [
        (k, v)
        for k, v in parse_qsl(p.query)
        if not k.lower().startswith("utm_") and k not in {"source", "ref", "gh_src"}
    ]
    return urlunsplit(
        (p.scheme, p.netloc.lower(), p.path.rstrip("/"), urlencode(sorted(query)), "")
    )


@dataclass
class Posting:
    source: str
    external_id: str
    title: str
    company: str
    location: str
    description: str
    url: str
    published: str = ""

    @property
    def fingerprint(self):
        return hashlib.sha256(canonical(self.url).encode()).hexdigest()


class JobDiscovery:
    def __init__(self, client=None):
        self.client = client or httpx.Client(timeout=30, follow_redirects=False)

    def close(self):
        self.client.close()

    def get(self, url, **kwargs):
        response = None
        for attempt in range(3):
            try:
                response = self.client.get(url, **kwargs)
                if (
                    response.status_code not in {429, 500, 502, 503, 504}
                    or attempt == 2
                ):
                    response.raise_for_status()
                    break
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == 2:
                    raise
            time.sleep(0.2 * (2**attempt))
        if len(response.content) > 20 * 1024 * 1024:
            raise ValueError("Source response exceeds the 20 MiB limit")
        data = response.json()
        if isinstance(data, dict) and data.get("error"):
            raise ValueError(
                "Job provider returned an error; check its configuration/quota"
            )
        return data

    def fetch(self, source: Source, role="", location="") -> list[Posting]:
        board = source.board
        if source.provider in {"greenhouse", "lever", "ashby"} and not re.fullmatch(
            r"[a-zA-Z0-9_-]{1,100}", board
        ):
            raise ValueError(f"{source.provider} requires a board identifier")
        if source.provider == "greenhouse":
            rows = self.get(
                f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs",
                params={"content": "true"},
            )["jobs"]
            return [
                Posting(
                    "greenhouse",
                    str(j["id"]),
                    j["title"],
                    board,
                    j.get("location", {}).get("name", ""),
                    plain(j.get("content")),
                    j["absolute_url"],
                    j.get("updated_at", ""),
                )
                for j in rows
            ]
        if source.provider == "lever":
            rows = self.get(
                f"https://api.lever.co/v0/postings/{board}", params={"mode": "json"}
            )
            return [
                Posting(
                    "lever",
                    j["id"],
                    j["text"],
                    board,
                    j.get("categories", {}).get("location", ""),
                    plain(j.get("descriptionPlain") or j.get("description"))
                    + "\n"
                    + "\n".join(plain(x.get("content")) for x in j.get("lists", [])),
                    j.get("applyUrl") or j["hostedUrl"],
                )
                for j in rows
            ]
        if source.provider == "ashby":
            rows = self.get(f"https://api.ashbyhq.com/posting-api/job-board/{board}")[
                "jobs"
            ]
            return [
                Posting(
                    "ashby",
                    j.get("id", j["jobUrl"]),
                    j["title"],
                    board,
                    j.get("location", "") + (" Remote" if j.get("isRemote") else ""),
                    j.get("descriptionPlain") or plain(j.get("descriptionHtml")),
                    j.get("applyUrl") or j["jobUrl"],
                    j.get("publishedAt", ""),
                )
                for j in rows
                if j.get("isListed", True)
            ]
        if source.provider == "workday":
            match = re.fullmatch(r"([a-zA-Z0-9_-]+)\.(wd\d+)\.([a-zA-Z0-9_-]+)", board)
            if not match:
                raise ValueError("Workday board syntax is tenant.wdN.boardName")
            tenant, cluster, name = match.groups()
            origin = f"https://{tenant}.{cluster}.myworkdayjobs.com"
            endpoint = f"{origin}/wday/cxs/{tenant}/{name}"
            results = []
            for page in range(get_settings().discovery_max_pages):
                response = self.client.post(
                    endpoint + "/jobs",
                    json={
                        "appliedFacets": {},
                        "limit": 20,
                        "offset": page * 20,
                        "searchText": role,
                    },
                )
                response.raise_for_status()
                data = response.json()
                rows = data.get("jobPostings", [])
                for j in rows:
                    path = j.get("externalPath", "")
                    if (
                        not path.startswith("/")
                        or path.startswith("//")
                        or ".." in path
                    ):
                        continue
                    if (
                        location
                        and location.lower() not in {"any", "anywhere", "all"}
                        and location.casefold()
                        not in j.get("locationsText", "").casefold()
                    ):
                        continue
                    detail = self.get(endpoint + path).get("jobPostingInfo", {})
                    results.append(
                        Posting(
                            "workday",
                            detail.get("jobReqId", path),
                            detail.get("title", j.get("title", "")),
                            tenant,
                            detail.get("location", j.get("locationsText", "")),
                            plain(detail.get("jobDescription", "")),
                            origin + "/" + name + path,
                            detail.get("startDate", ""),
                        )
                    )
                if not rows or (page + 1) * 20 >= data.get("total", len(rows)):
                    break
            return results
        if source.provider == "remotive":
            rows = self.get(
                "https://remotive.com/api/remote-jobs", params={"search": role}
            )["jobs"]
            return [
                Posting(
                    "remotive",
                    str(j["id"]),
                    j["title"],
                    j["company_name"],
                    j.get("candidate_required_location", "") + " Remote",
                    plain(j["description"]),
                    j["url"],
                    j.get("publication_date", ""),
                )
                for j in rows
            ]
        if source.provider == "google_jobs":
            key = get_settings().serpapi_api_key
            if not key:
                raise ValueError("Google Jobs requires SERPAPI_API_KEY")
            results = []
            token = None
            for _ in range(get_settings().discovery_max_pages):
                params = {"engine": "google_jobs", "q": role, "api_key": key}
                if location and location.lower() != "remote":
                    params["location"] = location
                if location.lower() == "remote":
                    params["q"] += " remote"
                if token:
                    params["next_page_token"] = token
                data = self.get("https://serpapi.com/search.json", params=params)
                for j in data.get("jobs_results", []):
                    options = j.get("apply_options", [])
                    if not options:
                        continue
                    # Prefer employer/ATS links over another portal when provided.
                    options = sorted(
                        options,
                        key=lambda x: any(
                            h in x.get("link", "")
                            for h in ("linkedin.com", "indeed.com", "glassdoor.com")
                        ),
                    )
                    results.append(
                        Posting(
                            "google_jobs",
                            j["job_id"],
                            j["title"],
                            j.get("company_name", ""),
                            j.get("location", ""),
                            j.get("description", ""),
                            options[0]["link"],
                            j.get("detected_extensions", {}).get("posted_at", ""),
                        )
                    )
                token = data.get("serpapi_pagination", {}).get("next_page_token")
                if not token:
                    break
            return results
        raise ValueError("Unknown discovery provider")

    def search(self, config: PlanConfig):
        found, errors = {}, []
        for source in config.sources:
            queries = (
                [(r, l) for r in config.roles for l in config.locations]
                if source.provider in {"google_jobs", "remotive", "workday"}
                else [("", "")]
            )
            for role, location in queries:
                try:
                    for job in self.fetch(source, role, location):
                        if not job.description or not any(
                            all(
                                t in job.title.casefold()
                                for t in re.findall(r"\w+", r.casefold())
                            )
                            for r in config.roles
                        ):
                            continue
                        if not any(
                            l.casefold() in {"any", "anywhere", "all"}
                            or l.casefold() in job.location.casefold()
                            for l in config.locations
                        ):
                            continue
                        found[job.fingerprint] = job
                        if len(found) >= get_settings().discovery_max_results:
                            break
                except Exception as exc:
                    # Never persist URL-bearing provider errors (may contain an API key).
                    errors.append(
                        f"{source.provider}/{source.board}: {type(exc).__name__}; check provider configuration or availability"
                    )
        return list(found.values())[: get_settings().discovery_max_results], errors
