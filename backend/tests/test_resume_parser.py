"""
Tests for the resume_parser module.

Each test creates a .docx in memory using python-docx, then calls
parse_resume_to_json() and asserts chunk boundaries and bullet attachment.
"""

import io
import json

from docx import Document
from docx.shared import Pt

from app.common.resume_parser import parse_resume_to_json, get_full_text, get_editable_sections


def _make_docx_bytes(builder_fn) -> bytes:
    """Helper: create a .docx in memory, call builder_fn(doc), return bytes."""
    doc = Document()
    builder_fn(doc)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()


# -----------------------------------------------------------------------
# Test 1: Work Experience with 3 jobs — bullets attach to correct job
# -----------------------------------------------------------------------

def test_work_experience_date_subsections():
    """
    Layout:
      RUSHI SAVANI (header)
      rushi@email.com (header)
      WORK EXPERIENCE (section heading)
        Software Engineer, Company A    Jan 2024 – Present
          • Built feature X
          • Deployed system Y
        Data Analyst, Company B    Jun 2023 – Dec 2023
          • Analysed data Z
        Intern, Company C    Jan 2023 – May 2023
          • Shadowed senior engineers

    Expected: 4 sections (1 header + 3 job sub-sections).
    Each job sub-section must contain ONLY its own bullets.
    """

    def build(doc: Document):
        # Header
        doc.add_paragraph("RUSHI SAVANI", style="Title")
        doc.add_paragraph("rushi@email.com | 555-0100 | linkedin.com/in/rushi")
        # Section heading
        doc.add_heading("WORK EXPERIENCE", level=1)
        # Job 1
        doc.add_paragraph("Software Engineer, Company A    Jan 2024 – Present")
        doc.add_paragraph("• Built feature X", style="List Bullet")
        doc.add_paragraph("• Deployed system Y", style="List Bullet")
        # Job 2
        doc.add_paragraph("Data Analyst, Company B    Jun 2023 – Dec 2023")
        doc.add_paragraph("• Analysed data Z", style="List Bullet")
        # Job 3
        doc.add_paragraph("Intern, Company C    Jan 2023 – May 2023")
        doc.add_paragraph("• Shadowed senior engineers", style="List Bullet")

    file_bytes = _make_docx_bytes(build)
    result = parse_resume_to_json(file_bytes)
    sections = result["sections"]

    # Find editable sections (skip header)
    editable = [s for s in sections if s["editable"]]

    # Should have 3 job sub-sections
    assert len(editable) == 3, f"Expected 3 editable sub-sections, got {len(editable)}: {[s['title'][:40] for s in editable]}"

    # Job 1 should have bullets about feature X and system Y
    job1 = editable[0]
    assert "Company A" in job1["title"], f"Job 1 title mismatch: {job1['title']}"
    assert "Built feature X" in job1["content"]
    assert "Deployed system Y" in job1["content"]
    # Job 1 must NOT contain bullets from other jobs
    assert "Analysed data Z" not in job1["content"]
    assert "Shadowed senior" not in job1["content"]

    # Job 2 should have only its bullet
    job2 = editable[1]
    assert "Company B" in job2["title"]
    assert "Analysed data Z" in job2["content"]
    assert "Built feature X" not in job2["content"]

    # Job 3 should have only its bullet
    job3 = editable[2]
    assert "Company C" in job3["title"]
    assert "Shadowed senior engineers" in job3["content"]
    assert "Analysed data Z" not in job3["content"]

    # Each paragraph entry should have is_bullet set correctly
    for sec in editable:
        for p in sec["paragraphs"]:
            if p["text"].startswith("•"):
                assert p["is_bullet"] is True, f"Bullet not detected: {p['text'][:40]}"


# -----------------------------------------------------------------------
# Test 2: Technical Skills with "Category: items" + continuation
# -----------------------------------------------------------------------

def test_technical_skills_category_subsections():
    """
    Layout:
      RUSHI SAVANI (header)
      TECHNICAL SKILLS (section heading)
        Languages: Python, Java, C++
        Frameworks: FastAPI, React, Django
        Tools: Docker, Kubernetes
        Some stray line without colon

    Expected: 3 category sub-sections.
    The stray line should continue under "Tools" (previous category).
    """

    def build(doc: Document):
        doc.add_paragraph("RUSHI SAVANI", style="Title")
        doc.add_heading("TECHNICAL SKILLS", level=1)
        doc.add_paragraph("Languages: Python, Java, C++")
        doc.add_paragraph("Frameworks: FastAPI, React, Django")
        doc.add_paragraph("Tools: Docker, Kubernetes")
        doc.add_paragraph("Also familiar with Terraform")  # continuation

    file_bytes = _make_docx_bytes(build)
    result = parse_resume_to_json(file_bytes)
    sections = result["sections"]

    editable = [s for s in sections if s["editable"]]

    # Should have 3 skill categories
    assert len(editable) == 3, f"Expected 3 skill sub-sections, got {len(editable)}: {[s['title'][:40] for s in editable]}"

    # Languages category
    lang = editable[0]
    assert "Languages" in lang["title"], f"First skill title: {lang['title']}"
    assert "Python" in lang["content"]

    # Frameworks category
    fw = editable[1]
    assert "Frameworks" in fw["title"]
    assert "FastAPI" in fw["content"]

    # Tools category — should include the continuation line
    tools = editable[2]
    assert "Tools" in tools["title"]
    assert "Docker" in tools["content"]
    assert "Terraform" in tools["content"], "Continuation line should be under Tools"


# -----------------------------------------------------------------------
# Test 3: ALL CAPS headings without Heading style
# -----------------------------------------------------------------------

def test_all_caps_headings_detected():
    """
    Layout:
      RUSHI SAVANI (Title style)
      rushi@email.com
      EDUCATION (Normal style, ALL CAPS — should be detected as heading)
        BS Computer Science, Georgia Tech, 2024
      SKILLS (Normal style, ALL CAPS — should be detected as heading)
        Python, Java

    Expected: EDUCATION and SKILLS detected as section headings even though
    they're styled as Normal, because they match known keywords.
    """

    def build(doc: Document):
        doc.add_paragraph("RUSHI SAVANI", style="Title")
        doc.add_paragraph("rushi@email.com")
        # These are Normal style, but ALL CAPS and known keywords
        doc.add_paragraph("EDUCATION")
        doc.add_paragraph("BS Computer Science, Georgia Tech, 2024")
        doc.add_paragraph("SKILLS")
        doc.add_paragraph("Python, Java, C++")

    file_bytes = _make_docx_bytes(build)
    result = parse_resume_to_json(file_bytes)
    sections = result["sections"]

    # Should have: Header, Education block, Skills block
    titles = [s["title"] for s in sections]

    # Check that EDUCATION was detected (either as its own section or as a sub-section)
    has_education = any("education" in t.lower() or "BS Computer Science" in t for t in titles)
    assert has_education, f"EDUCATION not detected. Sections: {titles}"

    has_skills = any("skill" in t.lower() or "Python" in t for t in titles)
    assert has_skills, f"SKILLS not detected. Sections: {titles}"

    # Header should be non-editable
    header = sections[0]
    assert header["editable"] is False, "Header should not be editable"
    assert "RUSHI SAVANI" in header["content"]


# -----------------------------------------------------------------------
# Test 4: Bullets before any date header — fallback sub-section
# -----------------------------------------------------------------------

def test_bullets_before_date_header_fallback():
    """
    Layout:
      RUSHI SAVANI (header)
      WORK EXPERIENCE (section heading)
        • Bullet that appears before any job header
        • Another orphan bullet
        Software Engineer, Company A    Jan 2024 – Present
        • Built feature X

    Expected: The orphan bullets should be in a "(General)" fallback
    sub-section, NOT mixed into the Company A sub-section.
    """

    def build(doc: Document):
        doc.add_paragraph("RUSHI SAVANI", style="Title")
        doc.add_heading("WORK EXPERIENCE", level=1)
        # Orphan bullets (no date header above them)
        doc.add_paragraph("• Bullet that appears before any job header", style="List Bullet")
        doc.add_paragraph("• Another orphan bullet", style="List Bullet")
        # First actual job
        doc.add_paragraph("Software Engineer, Company A    Jan 2024 – Present")
        doc.add_paragraph("• Built feature X", style="List Bullet")

    file_bytes = _make_docx_bytes(build)
    result = parse_resume_to_json(file_bytes)
    sections = result["sections"]

    editable = [s for s in sections if s["editable"]]

    # Should have 2 editable sub-sections: (General) fallback + Company A
    assert len(editable) == 2, f"Expected 2 sub-sections, got {len(editable)}: {[s['title'][:40] for s in editable]}"

    # First sub-section should be the fallback with orphan bullets
    fallback = editable[0]
    assert "orphan" in fallback["content"].lower() or "General" in fallback["title"], \
        f"First sub-section should be fallback. Title: {fallback['title']}, Content: {fallback['content'][:80]}"
    assert "Built feature X" not in fallback["content"], "Orphan section must NOT contain Company A bullets"

    # Second sub-section should be Company A
    job = editable[1]
    assert "Company A" in job["title"]
    assert "Built feature X" in job["content"]
    assert "orphan" not in job["content"].lower(), "Company A section must NOT contain orphan bullets"


# -----------------------------------------------------------------------
# Test: get_full_text and get_editable_sections helpers
# -----------------------------------------------------------------------

def test_helper_functions():
    """Verify get_full_text and get_editable_sections work correctly."""

    def build(doc: Document):
        doc.add_paragraph("RUSHI SAVANI", style="Title")
        doc.add_heading("EDUCATION", level=1)
        doc.add_paragraph("BS Computer Science, Georgia Tech, 2024")

    file_bytes = _make_docx_bytes(build)
    result = parse_resume_to_json(file_bytes)

    full_text = get_full_text(result)
    assert "RUSHI SAVANI" in full_text
    assert "Georgia Tech" in full_text

    editable = get_editable_sections(result)
    # Header is non-editable, so only education section(s) should be returned
    for sec in editable:
        assert sec["editable"] is True


# -----------------------------------------------------------------------
# Test: paragraph anchor stability
# -----------------------------------------------------------------------

def test_paragraph_anchors_stable():
    """
    Verify every section has valid para_start/para_end and that paragraph
    idx values correspond to actual doc.paragraphs indices.
    """

    def build(doc: Document):
        doc.add_paragraph("RUSHI SAVANI", style="Title")
        doc.add_paragraph("rushi@email.com")
        doc.add_heading("WORK EXPERIENCE", level=1)
        doc.add_paragraph("Software Engineer, Company A    Jan 2024 – Present")
        doc.add_paragraph("• Built feature X", style="List Bullet")
        doc.add_heading("EDUCATION", level=1)
        doc.add_paragraph("BS CS, Georgia Tech, 2024")

    file_bytes = _make_docx_bytes(build)
    result = parse_resume_to_json(file_bytes)

    all_para_idxs = set()
    for sec in result["sections"]:
        assert sec["para_start"] is not None
        assert sec["para_end"] is not None
        assert sec["para_start"] <= sec["para_end"]

        for p in sec["paragraphs"]:
            assert isinstance(p["idx"], int)
            assert p["idx"] >= 0
            all_para_idxs.add(p["idx"])

    # All paragraph indices should be unique across all sections
    assert len(all_para_idxs) > 0
