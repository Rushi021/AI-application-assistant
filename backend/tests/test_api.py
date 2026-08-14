from tests.conftest import AUTH, SAMPLE_TEX


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
    home = client.get("/")
    assert home.status_code == 200
    assert "Personal information" in home.text
    assert "Resume store" in home.text


def test_login_and_me(client):
    token = client.post("/auth/login", json={"username": "testuser", "password": "testpass"}).json()
    assert token["access_token"] == "test-token"
    me = client.get("/auth/me", headers=AUTH).json()
    assert me["username"] == "testuser"


def test_ingest_score_tailor_apply(client, tmp_path):
    tex = tmp_path / "resume.tex"
    tex.write_text(SAMPLE_TEX)
    with tex.open("rb") as handle:
        uploaded = client.post(
            "/resumes/upload",
            headers=AUTH,
            data={"family": "ai_ml", "version": "1"},
            files={"file": ("resume.tex", handle, "application/x-tex")},
        )
    assert uploaded.status_code == 200, uploaded.text
    resume = uploaded.json()
    assert resume["family"] == "ai_ml"
    assert any(s["name"] == "Experience" for s in resume["sections"])

    job = client.post(
        "/jobs/ingest",
        headers=AUTH,
        json={
            "raw_text": "Required: Python, SQL\nNice to have: Kubernetes\nWe need computer vision experience.",
            "company_name": "Acme",
            "role": "ML Engineer",
            "source": "manual",
        },
    )
    assert job.status_code == 200, job.text
    job_id = job.json()["id"]

    ranked = client.post("/matching/score", headers=AUTH, json={"job_id": job_id})
    assert ranked.status_code == 200, ranked.text
    body = ranked.json()
    assert body["recommended_resume_id"] == resume["id"]
    assert body["scores"][0]["total_score"] >= 0

    tailor = client.post(
        "/tailoring/runs",
        headers=AUTH,
        json={"job_id": job_id, "resume_id": resume["id"], "do_tailor": True, "personalized_instructions": "keep metrics"},
    )
    assert tailor.status_code == 200, tailor.text
    run_id = tailor.json()["id"]
    finalized = client.post(f"/tailoring/runs/{run_id}/finalize", headers=AUTH)
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["final_latex"]

    applied = client.post(
        "/applications",
        headers=AUTH,
        json={"job_id": job_id, "resume_id": resume["id"], "tailor_run_id": run_id, "status": "applied"},
    )
    assert applied.status_code == 200, applied.text
    outcome = client.post(
        f"/applications/{applied.json()['id']}/outcome",
        headers=AUTH,
        json={"succeeded": True},
    )
    assert outcome.json()["outcome"] == "succeeded"

    scrape = client.post(
        "/scraping/search",
        headers=AUTH,
        json={"roles": ["ML Engineer", "Data scientist"], "locations": ["NYC", "Remote"]},
    )
    assert scrape.status_code == 200
    assert scrape.json()["provider"] == "noop"
    assert scrape.json()["results"] == []


def test_profile_roundtrip(client):
    saved = client.put(
        "/profile",
        headers=AUTH,
        json={
            "full_name": "Rushi",
            "email": "a@b.com",
            "desired_salary_base": 150000,
            "willing_to_relocate": True,
            "highest_degree": "Master's",
            "school_name": "NYU",
            "field_of_study": "Computer Science",
            "graduation_date": "2024-05",
            "gpa": "3.8",
            "education": [
                {
                    "degree": "Bachelor's",
                    "school_name": "Rutgers",
                    "field_of_study": "Computer Science",
                    "graduation_date": "2020-05",
                    "gpa": "3.6",
                }
            ],
            "work_auth_country": "United States",
            "legally_authorized_to_work": True,
            "needs_sponsorship": False,
            "citizenship_country": "India",
            "at_least_18": True,
            "has_non_compete": False,
            "gender": "Prefer not to say",
            "race_ethnicity": "Asian",
            "veteran_status": "I am not a veteran",
            "disability_status": "Prefer not to say",
        },
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["desired_salary_base"] == 150000
    assert body["desired_salary_min"] == 150000
    assert body["desired_salary_max"] == 160000
    got = client.get("/profile", headers=AUTH)
    data = got.json()
    assert data["full_name"] == "Rushi"
    assert data["legally_authorized_to_work"] is True
    assert data["needs_sponsorship"] is False
    assert data["highest_degree"] == "Master's"
    assert data["willing_to_relocate"] is True
    assert data["education"][0]["school_name"] == "Rutgers"


def test_delete_resume(client, tmp_path):
    tex = tmp_path / "r.tex"
    tex.write_text(SAMPLE_TEX)
    with tex.open("rb") as handle:
        uploaded = client.post(
            "/resumes/upload",
            headers=AUTH,
            data={"family": "data_science", "version": "1"},
            files={"file": ("r.tex", handle, "application/x-tex")},
        )
    resume_id = uploaded.json()["id"]
    deleted = client.delete(f"/resumes/{resume_id}", headers=AUTH)
    assert deleted.status_code == 204
