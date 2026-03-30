"""Shared fixtures for backend tests."""

import io
import uuid

import pytest
from docx import Document


@pytest.fixture(scope="module")
def integration_session_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def minimal_resume_docx_bytes() -> bytes:
    """Valid .docx with header + experience mentioning Python/AWS for keyword scoring."""
    doc = Document()
    doc.add_paragraph("Jane Doe")
    doc.add_paragraph("jane@example.com | Boston, MA")
    doc.add_paragraph("WORK EXPERIENCE")
    p = doc.add_paragraph()
    p.add_run("Software Engineer, Acme Corp").bold = True
    doc.add_paragraph(
        "Built APIs in Python on AWS. Led microservices migration.",
        style="List Bullet",
    )
    doc.add_paragraph("SKILLS")
    doc.add_paragraph("Python, AWS, SQL, FastAPI")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()
