"""The .docx contract: tailoring may change wording, never layout."""

from __future__ import annotations

import io
import os

from docx import Document

from app.modules.documents.docx_writer import write_docx
from app.modules.resumes.docx_parser import parse_docx
from app.modules.resumes.parsed import FROZEN_ALIGNED, FROZEN_SECTION, FROZEN_TITLE
from tests.conftest import AUTH, build_sample_docx


def _paragraphs(data: bytes) -> list:
    from app.modules.resumes.docx_parser import iter_paragraphs

    return iter_paragraphs(Document(io.BytesIO(data)))


def _find(parsed, section_name: str):
    return next(section for section in parsed.sections if section.name == section_name)


def test_parse_freezes_title_headers_and_education():
    parsed = parse_docx(build_sample_docx())

    title = _find(parsed, "Name & contact")
    assert title.frozen_reason == FROZEN_TITLE
    # The bold name line must not be mistaken for a section header.
    assert [bullet.text for bullet in title.bullets][0] == "Rushi Patel"
    assert all(not bullet.editable for bullet in title.bullets)

    education = _find(parsed, "EDUCATION")
    assert education.frozen_reason == FROZEN_SECTION
    assert all(not bullet.editable for bullet in education.bullets)

    experience = _find(parsed, "EXPERIENCE")
    dated, *bullets = experience.bullets
    assert dated.frozen_reason == FROZEN_ALIGNED
    assert [bullet.editable for bullet in bullets] == [True, True]

    skills = _find(parsed, "TECHNICAL SKILLS")
    assert all(bullet.editable for bullet in skills.bullets)

    # Section headers are their own paragraphs and are never offered for editing.
    header_locators = {section.locator for section in parsed.sections if section.locator is not None}
    offered = {
        bullet.locator
        for section in parsed.sections
        for bullet in section.bullets
        if bullet.editable
    }
    assert header_locators.isdisjoint(offered)


def test_write_keeps_every_frozen_line_and_all_formatting(tmp_path):
    original = build_sample_docx()
    parsed = parse_docx(original)
    before = _paragraphs(original)

    bullet_locator = _find(parsed, "EXPERIENCE").bullets[1].locator
    skills_locator = _find(parsed, "TECHNICAL SKILLS").bullets[0].locator
    education_locator = _find(parsed, "EDUCATION").bullets[1].locator

    out = str(tmp_path / "tailored.docx")
    result = write_docx(
        original,
        {
            bullet_locator: "Trained computer vision models on radiology scans",
            skills_locator: "Languages: Python, SQL, R, Scala",
            education_locator: "should never be written",
        },
        out,
        frozen={education_locator},
    )
    assert result.applied == 2
    assert any("frozen" in refusal for refusal in result.refused)

    after = _paragraphs(open(out, "rb").read())
    assert len(after) == len(before)

    # Everything we did not edit is byte-identical, headers and title included.
    edited = {bullet_locator, skills_locator}
    for index, (old, new) in enumerate(zip(before, after)):
        if index not in edited:
            assert new.text == old.text, f"paragraph {index} drifted"

    assert after[bullet_locator].text == "Trained computer vision models on radiology scans"
    # List style and indentation come from the original paragraph, untouched.
    assert after[bullet_locator].style.name == before[bullet_locator].style.name
    assert after[bullet_locator].paragraph_format.left_indent == before[bullet_locator].paragraph_format.left_indent

    # The bold "Languages: " label is a separate run and must still be bold.
    skills_runs = [(run.text, run.bold) for run in after[skills_locator].runs if run.text]
    assert ("Languages: ", True) in skills_runs
    assert after[skills_locator].text == "Languages: Python, SQL, R, Scala"

    # The name keeps its 20pt bold run.
    assert after[0].runs[0].bold is True
    assert after[0].runs[0].font.size == before[0].runs[0].font.size


def test_write_refuses_to_reflow_a_right_aligned_line(tmp_path):
    original = build_sample_docx()
    parsed = parse_docx(original)
    dated = _find(parsed, "EXPERIENCE").bullets[0]

    out = str(tmp_path / "tabbed.docx")
    result = write_docx(original, {dated.locator: "Acme Corp - Senior Data Scientist"}, out)

    assert result.applied == 0
    assert any("right-aligned" in refusal for refusal in result.refused)
    assert _paragraphs(open(out, "rb").read())[dated.locator].text == dated.text


def test_dates_aligned_with_spaces_are_protected_like_tabs():
    from app.modules.resumes.docx_parser import has_column_alignment

    # Real templates push the date right with runs of spaces, not only tabs.
    assert has_column_alignment("AI Engineer / Data Science Intern     Jun 2025 - May 2026")
    assert has_column_alignment("Employer\tCity, State")
    # A normal bullet or skills line must stay editable.
    assert not has_column_alignment("Built Python pipelines processing 2M records daily")
    assert not has_column_alignment("Languages: Python, SQL, R")


def test_docx_upload_tailor_finalize_and_auto_apply(client, tmp_path):
    docx = tmp_path / "Rushi_Patel_DataScience.docx"
    docx.write_bytes(build_sample_docx())
    with docx.open("rb") as handle:
        uploaded = client.post(
            "/resumes/upload",
            headers=AUTH,
            data={"family": "data_science", "version": "1"},
            files={
                "file": (
                    docx.name,
                    handle,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )
    assert uploaded.status_code == 200, uploaded.text
    resume = uploaded.json()
    assert resume["source_format"] == "docx"
    # A .docx upload is now parsed, so scoring has real text to work with.
    assert any(section["name"] == "EXPERIENCE" for section in resume["sections"])

    job = client.post(
        "/jobs/ingest",
        headers=AUTH,
        json={
            "raw_text": "Required: Python, SQL, computer vision",
            "company_name": "Acme Corp",
            "role": "Data Scientist",
            "source": "manual",
        },
    ).json()

    tailor = client.post(
        "/tailoring/runs",
        headers=AUTH,
        json={"job_id": job["id"], "resume_id": resume["id"], "do_tailor": True},
    )
    assert tailor.status_code == 200, tailor.text
    run_id = tailor.json()["id"]

    finalized = client.post(f"/tailoring/runs/{run_id}/finalize", headers=AUTH)
    assert finalized.status_code == 200, finalized.text
    produced = finalized.json()["final_docx_key"]
    assert produced and os.path.exists(produced)

    # The tailored document keeps the uploaded layout line for line.
    before = _paragraphs(build_sample_docx())
    after = _paragraphs(open(produced, "rb").read())
    assert len(after) == len(before)
    parsed = parse_docx(build_sample_docx())
    frozen = {section.locator for section in parsed.sections if section.locator is not None}
    frozen |= {
        bullet.locator
        for section in parsed.sections
        for bullet in section.bullets
        if not bullet.editable
    }
    for locator in sorted(frozen):
        assert after[locator].text == before[locator].text
    # ...and the editable bullets really were rewritten.
    experience = _find(parsed, "EXPERIENCE").bullets[1].locator
    assert after[experience].text != before[experience].text

    applied = client.post(f"/tailoring/runs/{run_id}/auto-apply", headers=AUTH)
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["status"] == "auto_apply"
    assert body["export_dir"].endswith(os.path.join("library", "Data Science"))
    assert body["exported_docx_path"].endswith("Rushi_Patel_DataScience_Acme Corp.docx")
    assert os.path.exists(body["exported_docx_path"])


def test_auto_apply_logs_the_tracker_record(client, tmp_path):
    docx = tmp_path / "Rushi_DS.docx"
    docx.write_bytes(build_sample_docx())
    with docx.open("rb") as handle:
        resume = client.post(
            "/resumes/upload",
            headers=AUTH,
            data={"family": "data_science", "version": "2"},
            files={"file": (docx.name, handle, "application/octet-stream")},
        ).json()
    job = client.post(
        "/jobs/ingest",
        headers=AUTH,
        json={
            "raw_text": "Required: Python, SQL",
            "company_name": "Initech",
            "role": "Data Scientist",
            "source": "manual",
        },
    ).json()
    run = client.post(
        "/tailoring/runs",
        headers=AUTH,
        json={"job_id": job["id"], "resume_id": resume["id"], "do_tailor": True},
    ).json()
    filed = client.post(f"/tailoring/runs/{run['id']}/auto-apply", headers=AUTH).json()

    logged = client.get("/applications", headers=AUTH).json()
    assert len(logged) == 1
    record = logged[0]
    assert record["company_name"] == "Initech"
    assert record["role"] == "Data Scientist"
    assert record["resume_family"] == "data_science"
    assert record["resume_tailored"] is True
    assert record["status"] == "auto_apply"
    assert record["applied_at"] is not None
    assert record["document_path"] == filed["exported_docx_path"]
    assert record["tailor_run_id"] == run["id"]

    # Marking applied updates that row instead of adding a second one.
    marked = client.post(
        "/applications",
        headers=AUTH,
        json={
            "job_id": job["id"],
            "resume_id": resume["id"],
            "tailor_run_id": run["id"],
            "status": "applied",
        },
    ).json()
    assert marked["id"] == record["id"]
    assert marked["status"] == "applied"
    assert len(client.get("/applications", headers=AUTH).json()) == 1
    # The date applied is stamped once, at auto-apply, and does not move.
    assert marked["applied_at"] == record["applied_at"]

    outcome = client.post(f"/applications/{record['id']}/outcome", headers=AUTH, json={"succeeded": True}).json()
    assert outcome["outcome"] == "succeeded"
    assert outcome["company_name"] == "Initech"


def test_auto_apply_finalizes_a_run_that_was_not_finalized(client, tmp_path):
    """The one-click web path goes straight to auto-apply."""
    docx = tmp_path / "Base_AIML.docx"
    docx.write_bytes(build_sample_docx())
    with docx.open("rb") as handle:
        resume = client.post(
            "/resumes/upload",
            headers=AUTH,
            data={"family": "ai_ml", "version": "1"},
            files={"file": (docx.name, handle, "application/octet-stream")},
        ).json()
    job = client.post(
        "/jobs/ingest",
        headers=AUTH,
        json={"raw_text": "Required: Python", "company_name": "Globex", "source": "manual"},
    ).json()
    run = client.post(
        "/tailoring/runs",
        headers=AUTH,
        json={"job_id": job["id"], "resume_id": resume["id"], "do_tailor": False},
    ).json()
    assert run["status"] == "ready"

    filed = client.post(f"/tailoring/runs/{run['id']}/auto-apply", headers=AUTH)
    assert filed.status_code == 200, filed.text
    body = filed.json()
    assert body["status"] == "auto_apply"
    assert body["export_dir"].endswith(os.path.join("library", "AI ML"))
    assert body["exported_docx_path"].endswith("Base_AIML_Globex.docx")
    assert os.path.exists(body["exported_docx_path"])
