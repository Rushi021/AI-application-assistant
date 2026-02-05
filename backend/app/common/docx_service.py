"""
Parse and apply edits to Word (.docx) resumes while preserving format, font, and spacing.

- parse_docx: extract paragraph text and structure so the same document can be reconstructed.
- apply_tailored_sections: replace paragraph content with tailored text, keeping styles and font.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import List

from docx import Document
from docx.document import Document as DocumentType
from docx.table import Table
from docx.text.paragraph import Paragraph


SECTION_DELIMITER = "\n---SECTION---\n"


@dataclass
class DocxParseResult:
    """Result of parsing a docx: plain text for LLM and number of content blocks (paragraphs)."""

    plain_text: str
    """Full resume text in section order, for LLM context."""
    num_paragraphs: int
    """Number of body paragraphs (used to split LLM sectioned output)."""


def _iter_body_paragraphs(doc: DocumentType):
    """Yield all paragraphs in document order (body paragraphs and table cell paragraphs)."""
    for block in doc.iter_inner_content():
        if isinstance(block, Paragraph):
            yield block
        else:
            assert isinstance(block, Table)
            for row in block.rows:
                for cell in row.cells:
                    for p in cell.paragraphs:
                        yield p


def parse_docx(file_bytes: bytes) -> DocxParseResult:
    """
    Parse a .docx file and return plain text plus paragraph count.
    Only body and table paragraphs are included; order is preserved.
    """
    doc = Document(io.BytesIO(file_bytes))
    paragraphs: List[Paragraph] = list(_iter_body_paragraphs(doc))
    texts = [p.text.strip() for p in paragraphs]
    # Build plain text: one block per paragraph so we can later map section-by-section
    plain_text = "\n\n".join(texts) if texts else ""
    return DocxParseResult(plain_text=plain_text, num_paragraphs=len(paragraphs))


def _copy_font(source, target) -> None:
    """Copy font properties from source run to target run (both have .font)."""
    if source is None:
        return
    # Copy common properties
    for attr in ("bold", "italic", "underline", "size", "name", "color"):
        if hasattr(source, attr):
            val = getattr(source, attr)
            if hasattr(target, attr) and val is not None:
                setattr(target, attr, val)


def apply_tailored_sections(file_bytes: bytes, tailored_sections: List[str]) -> bytes:
    """
    Replace paragraph content in the docx with tailored_sections while preserving
    paragraph style and font (from the first run of each paragraph).
    Returns the modified document as bytes.
    """
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = list(_iter_body_paragraphs(doc))
    for i, para in enumerate(paragraphs):
        if i >= len(tailored_sections):
            break
        new_text = tailored_sections[i]
        # Preserve style: get font from first run, then clear and add one run with new text
        first_run = para.runs[0] if para.runs else None
        para.clear()
        new_run = para.add_run(new_text)
        if first_run is not None:
            _copy_font(first_run.font, new_run.font)
        # Keep paragraph-level style
        if para.style is not None:
            pass  # style is already on paragraph, clear() doesn't remove it

    out = io.BytesIO()
    doc.save(out)
    out.seek(0)
    return out.read()


def build_sectioned_resume_text(parse_result: DocxParseResult) -> str:
    """
    Build the resume text we send to the LLM with explicit section markers
    so the model can return the same number of sections.
    """
    if not parse_result.plain_text:
        return ""
    # We use double newline as paragraph separator; for the prompt we can number them
    parts = parse_result.plain_text.split("\n\n")
    return "\n\n".join(f"[Section {i+1}]\n{p}" for i, p in enumerate(parts))


def parse_sectioned_tailored_output(tailored_output: str, num_paragraphs: int) -> List[str]:
    """
    Split the LLM's tailored resume into one string per paragraph/section.
    The LLM is instructed to use SECTION_DELIMITER between sections.
    If delimiter is missing, fall back to splitting by [Section N] or by double newlines.
    """
    if SECTION_DELIMITER in tailored_output:
        sections = [s.strip() for s in tailored_output.split(SECTION_DELIMITER)]
    else:
        # Fallback: split by [Section N] or by double newline
        import re
        parts = re.split(r"\n?\[Section \d+\]\s*\n?", tailored_output)
        sections = [p.strip() for p in parts if p.strip()]
    # Normalize to exactly num_paragraphs (pad with empty or truncate)
    result: List[str] = []
    for i in range(num_paragraphs):
        result.append(sections[i] if i < len(sections) else "")
    return result[:num_paragraphs]
