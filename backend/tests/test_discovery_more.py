import httpx
from app.modules.agent.discovery import JobDiscovery
from app.modules.agent.schemas import Source, PlanConfig


def test_workday_query_pagination_and_detail():
    calls = []

    def handler(request):
        calls.append(request)
        if request.method == "POST":
            return httpx.Response(
                200,
                json={
                    "total": 1,
                    "jobPostings": [
                        {
                            "title": "Software Engineer",
                            "locationsText": "Remote",
                            "externalPath": "/job/Remote/Software-Engineer_123",
                        }
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "jobPostingInfo": {
                    "title": "Software Engineer",
                    "location": "Remote",
                    "jobReqId": "123",
                    "jobDescription": "<p>Python services</p>",
                }
            },
        )

    discovery = JobDiscovery(httpx.Client(transport=httpx.MockTransport(handler)))
    rows = discovery.fetch(
        Source(provider="workday", board="example.wd5.Careers"),
        "Software Engineer",
        "Remote",
    )
    assert len(rows) == 1 and rows[0].description == "Python services"
    assert (
        rows[0].url
        == "https://example.wd5.myworkdayjobs.com/Careers/job/Remote/Software-Engineer_123"
    )
    assert calls[0].method == "POST" and len(calls) == 2


def test_google_jobs_pages_and_employer_link_priority(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("SERPAPI_API_KEY", "fixture-secret")
    get_settings.cache_clear()
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.params["api_key"] == "fixture-secret"
        return httpx.Response(
            200,
            json={
                "jobs_results": [
                    {
                        "job_id": str(len(calls)),
                        "title": "Software Engineer",
                        "company_name": "Example",
                        "location": "Remote",
                        "description": "Python",
                        "apply_options": [
                            {"link": "https://www.linkedin.com/jobs/view/123"},
                            {"link": "https://jobs.lever.co/example/a"},
                        ],
                    }
                ],
                **(
                    {"serpapi_pagination": {"next_page_token": "page2"}}
                    if len(calls) == 1
                    else {}
                ),
            },
        )

    discovery = JobDiscovery(httpx.Client(transport=httpx.MockTransport(handler)))
    rows, errors = discovery.search(
        PlanConfig(
            resume_id=1,
            roles=["Software Engineer"],
            locations=["Remote"],
            sources=[Source(provider="google_jobs")],
        )
    )
    assert not errors and len(calls) == 2 and len(rows) == 1
    assert rows[0].url == "https://jobs.lever.co/example/a"
    get_settings.cache_clear()


def test_model_rest_credentials_and_batch_dimensions(monkeypatch):
    from app.core.config import get_settings
    from app.modules.ai.providers.llm.gemini import GeminiLLMProvider
    from app.modules.ai.providers.embeddings.gemini import GeminiEmbeddingProvider

    monkeypatch.setenv("GOOGLE_AI_API_KEY", "fixture-key")
    get_settings.cache_clear()

    def post(url, headers, json, timeout):
        assert headers["x-goog-api-key"] == "fixture-key" and "fixture-key" not in url
        assert timeout > 0
        if "batchEmbedContents" in url:
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "embeddings": [{"values": [0.1] * 768} for _ in json["requests"]]
                },
            )
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"candidates": [{"content": {"parts": [{"text": "usable"}]}}]},
        )

    monkeypatch.setattr(httpx, "post", post)
    assert GeminiLLMProvider("test-model").generate("input").text == "usable"
    embedded = GeminiEmbeddingProvider("test-embedding").embed(["one", "two"])
    assert len(embedded.vectors) == 2 and embedded.dimensions == 768
    get_settings.cache_clear()
