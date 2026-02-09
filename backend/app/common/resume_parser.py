"""
Unified resume parser: parse a .docx into a canonical JSON structure.

This is the SINGLE source of truth for resume structure. Every downstream
consumer (LLM prompts, draft creation, scoring, docx reconstruction) reads
from the JSON produced here.

Architecture — 2-phase chunking:
  Phase 1: Build a list of Block dataclasses (one per paragraph) with
           pre-computed flags (is_bullet, bold_ratio, all_caps, etc.).
  Phase 2: Detect section headers, then dispatch to per-section-type
           sub-section handlers for accurate chunk boundaries.
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from docx import Document
from docx.text.paragraph import Paragraph

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Word XML namespace for direct element inspection
# ---------------------------------------------------------------------------
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# ---------------------------------------------------------------------------
# Constants: section keyword sets
# ---------------------------------------------------------------------------

# Sections that use DATE-based sub-section splitting
_DATE_SUBSECTION_TYPES = {
    "work experience", "experience", "professional experience",
    "projects", "academic projects", "personal projects",
    "academic projects and publication", "academic projects and publications",
    "projects and publication", "projects and publications",
    "leadership", "leadership experience", "leadership & activities",
    "activities", "extracurricular activities",
    "volunteer", "volunteer experience",
}

# Sections that use EDUCATION sub-section splitting
_EDUCATION_TYPES = {"education"}

# Sections that use SKILLS (Category: items) sub-section splitting
_SKILLS_TYPES = {"skills", "technical skills"}

# ALL known section heading keywords (union of all above + flat sections)
_ALL_SECTION_KEYWORDS = _DATE_SUBSECTION_TYPES | _EDUCATION_TYPES | _SKILLS_TYPES | {
    "certifications", "certificates", "awards", "honors", "publications",
    "interests", "summary", "objective", "professional summary", "profile",
    "languages", "references", "coursework", "relevant coursework",
}

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

_DATE_PATTERN = re.compile(
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
    r"|january|february|march|april|june|july|august|september|october|november|december"
    r"|present|current)\b",
    re.IGNORECASE,
)

# Year pattern for education entries (4-digit year)
_YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")

_DEGREE_PATTERN = re.compile(
    r"\b(?:bachelor|master|doctor|phd|ph\.d|associate|diploma"
    r"|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|b\.?e\.?|m\.?e\.?"
    r"|b\.?sc|m\.?sc|b\.?tech|m\.?tech|m\.?b\.?a)\b",
    re.IGNORECASE,
)

# Bullet leading characters (after optional whitespace)
_BULLET_CHARS = ("•", "-", "–", "—", "●", "○", "▪", "►", "*", "‣", "⁃")


# ===================================================================
# Phase 1 — Block model & construction
# ===================================================================

@dataclass
class Block:
    """Intermediate model for one paragraph, fully classified before chunking."""
    idx: int                 # paragraph index within doc.paragraphs
    text: str                # trimmed text
    style: str               # style name (lowercase)
    is_heading_style: bool   # style contains "heading"
    is_bullet: bool          # list style OR leading bullet chars
    bold_ratio: float        # fraction of text chars that are bold (0.0–1.0)
    all_caps: bool           # >=80% uppercase alpha chars
    para: Paragraph = field(repr=False)  # live docx object (not serialised)


# ---------------------------------------------------------------------------
# Bold detection helpers (kept from previous version)
# ---------------------------------------------------------------------------

def _is_run_bold(run) -> bool:
    """Check if a single run is bold (explicit, font-level, or XML)."""
    if run.bold is True:
        return True
    if run.font and run.font.bold is True:
        return True
    if hasattr(run, "_element"):
        rpr = run._element.find(f"{_W}rPr")
        if rpr is not None:
            b = rpr.find(f"{_W}b")
            if b is not None:
                val = b.get(f"{_W}val")
                if val is None or val.lower() in ("1", "true"):
                    return True
    return False


def _is_paragraph_bold(para: Paragraph) -> bool:
    """Check if a paragraph's visible text is predominantly bold."""
    if not para.runs:
        if para.style and hasattr(para.style, "font") and para.style.font.bold:
            return True
        return False

    bold_chars = 0
    total_chars = 0
    style_is_bold = False
    if para.style and hasattr(para.style, "font") and para.style.font.bold:
        style_is_bold = True

    for run in para.runs:
        length = len(run.text)
        if length == 0:
            continue
        total_chars += length
        if _is_run_bold(run):
            bold_chars += length
        elif style_is_bold and run.bold is None:
            bold_chars += length

    if total_chars == 0:
        return False
    return (bold_chars / total_chars) >= 0.5


# ---------------------------------------------------------------------------
# Block classification helpers
# ---------------------------------------------------------------------------

def _is_bullet(para: Paragraph, text: str) -> bool:
    """
    Detect bullet paragraphs by style OR leading characters.
    """
    style_name = (para.style.name or "").lower() if para.style else ""
    if "list" in style_name:
        return True
    stripped = text.lstrip()
    if stripped and stripped[0] in "".join(_BULLET_CHARS):
        return True
    return False


def _compute_bold_ratio(para: Paragraph) -> float:
    """Return fraction of text characters that are bold (0.0–1.0)."""
    if not para.runs:
        if para.style and hasattr(para.style, "font") and para.style.font.bold:
            return 1.0
        return 0.0

    bold_chars = 0
    total_chars = 0
    style_is_bold = False
    if para.style and hasattr(para.style, "font") and para.style.font.bold:
        style_is_bold = True

    for run in para.runs:
        length = len(run.text)
        if length == 0:
            continue
        total_chars += length
        if _is_run_bold(run):
            bold_chars += length
        elif style_is_bold and run.bold is None:
            bold_chars += length

    return (bold_chars / total_chars) if total_chars > 0 else 0.0


def _is_all_caps(text: str) -> bool:
    """Check if >=80% of alpha characters are uppercase."""
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 2:
        return False
    return sum(1 for c in letters if c.isupper()) / len(letters) >= 0.8


def _build_blocks(paragraphs: List[Paragraph]) -> List[Block]:
    """Phase 1: classify every paragraph into a Block."""
    blocks: List[Block] = []
    for pi, para in enumerate(paragraphs):
        text = para.text.strip()
        style_name = (para.style.name or "").lower() if para.style else ""
        blocks.append(Block(
            idx=pi,
            text=text,
            style=style_name,
            is_heading_style="heading" in style_name,
            is_bullet=_is_bullet(para, text),
            bold_ratio=_compute_bold_ratio(para),
            all_caps=_is_all_caps(text),
            para=para,
        ))
    return blocks


# ===================================================================
# Phase 2 — Section detection & sub-section chunking
# ===================================================================

# ---------------------------------------------------------------------------
# Section-heading detection
# ---------------------------------------------------------------------------

def _normalize_heading_text(text: str) -> str:
    return re.sub(r"[^a-zA-Z\s&]", "", text).strip().lower()


def _is_known_section_heading(text: str) -> bool:
    return _normalize_heading_text(text) in _ALL_SECTION_KEYWORDS


def _is_section_heading(block: Block) -> bool:
    """
    Detect section headers with a clean priority chain:
    1. Known keyword match (most reliable)
    2. Heading style + keyword match
    3. Short ALL-CAPS line with heading style (<=5 words)
    """
    if not block.text:
        return False
    # Priority 1: keyword match always wins
    if _is_known_section_heading(block.text):
        return True
    # Priority 2: heading style + ALL CAPS + short line
    if block.is_heading_style and block.all_caps and len(block.text.split()) <= 5:
        return True
    # Priority 3: ALL CAPS + short line + NOT a bullet (fallback for unstyled docs)
    if (block.all_caps
            and not block.is_bullet
            and len(block.text.split()) <= 4
            and _is_known_section_heading(block.text)):
        return True  # already caught by P1, but explicit
    return False


def _make_section_id(title: str, idx: int) -> str:
    safe = re.sub(r"[^a-z0-9_]", "_", title.lower().strip())
    safe = re.sub(r"_+", "_", safe).strip("_")[:60]
    return f"{safe}_{idx}"


# ---------------------------------------------------------------------------
# Per-paragraph formatting capture (kept from previous version)
# ---------------------------------------------------------------------------

def _extract_para_fmt(para: Paragraph) -> Dict[str, Any]:
    """Extract formatting metadata from the first run of a paragraph."""
    fmt: Dict[str, Any] = {
        "bold": None,
        "italic": None,
        "underline": None,
        "font_name": None,
        "font_size_pt": None,
        "color_rgb": None,
    }
    if not para.runs:
        return fmt

    first_run = para.runs[0]
    font = first_run.font

    fmt["bold"] = _is_run_bold(first_run)
    fmt["italic"] = first_run.italic if first_run.italic is not None else False
    fmt["underline"] = bool(first_run.underline) if first_run.underline is not None else False
    fmt["font_name"] = font.name if font.name else None
    if font.size is not None:
        fmt["font_size_pt"] = font.size.pt
    if font.color and font.color.rgb:
        fmt["color_rgb"] = str(font.color.rgb)

    return fmt


def _build_paragraph_entry(block: Block) -> Dict[str, Any]:
    """Build a JSON-serialisable dict for one paragraph."""
    style_name = (block.para.style.name or "") if block.para.style else ""
    return {
        "idx": block.idx,
        "text": block.text,
        "style": style_name,
        "is_bullet": block.is_bullet,
        "fmt": _extract_para_fmt(block.para),
    }


# ---------------------------------------------------------------------------
# Shared helpers for sub-section chunkers
# ---------------------------------------------------------------------------

def _make_chunk(
    title: str,
    blocks: List[Block],
    sec_idx: int,
    editable: bool = True,
) -> Dict[str, Any]:
    """Build one canonical section/sub-section dict from a contiguous block range."""
    paras = [_build_paragraph_entry(b) for b in blocks]
    content = "\n".join(b.text for b in blocks if b.text)
    para_start = blocks[0].idx if blocks else 0
    para_end = (blocks[-1].idx + 1) if blocks else 0
    return {
        "id": _make_section_id(title, sec_idx),
        "title": title,
        "editable": editable,
        "order": sec_idx,
        "para_start": para_start,
        "para_end": para_end,
        "content": content,
        "paragraphs": paras,
    }


def _has_date_range(text: str) -> bool:
    """Check if text contains a date/timeline pattern."""
    if _DATE_PATTERN.search(text):
        return True
    # Also match "2023 - 2024" style year ranges
    if _YEAR_PATTERN.search(text):
        return True
    return False


# ---------------------------------------------------------------------------
# Sub-section chunker: Date-based (Work Experience, Projects, etc.)
# ---------------------------------------------------------------------------

def _chunk_date_subsections(
    blocks: List[Block],
    section_heading_block: Block,
) -> List[tuple[str, List[Block]]]:
    """
    Split blocks under a Work Experience / Projects section into sub-sections.

    Sub-section header = non-bullet line containing a date/timeline pattern.
    Bullets after a header attach to that sub-section.
    If bullets appear before any date-header, a fallback "(General)" sub-section
    is created to capture them.
    """
    # blocks[0] is the first paragraph AFTER the section heading
    subsections: List[tuple[str, List[Block]]] = []  # (title, blocks)
    current_title: Optional[str] = None
    current_blocks: List[Block] = []

    for block in blocks:
        if not block.text:
            # Keep empty paragraphs in the current sub-section for spacing
            current_blocks.append(block)
            continue

        # Is this a sub-section header? (non-bullet with date/timeline)
        if not block.is_bullet and _has_date_range(block.text):
            # Save previous sub-section
            if current_blocks:
                title = current_title or "(General)"
                subsections.append((title, current_blocks))

            current_title = block.text
            current_blocks = [block]
        else:
            # Attach to current sub-section
            current_blocks.append(block)

    # Save last sub-section
    if current_blocks:
        title = current_title or "(General)"
        subsections.append((title, current_blocks))

    return subsections


# ---------------------------------------------------------------------------
# Sub-section chunker: Education
# ---------------------------------------------------------------------------

def _chunk_education_subsections(
    blocks: List[Block],
    section_heading_block: Block,
) -> List[tuple[str, List[Block]]]:
    """
    Split blocks under an Education section into sub-sections.

    Sub-section header = non-bullet line containing a degree keyword OR a year.
    """
    subsections: List[tuple[str, List[Block]]] = []
    current_title: Optional[str] = None
    current_blocks: List[Block] = []

    for block in blocks:
        if not block.text:
            current_blocks.append(block)
            continue

        # Is this an education sub-section header?
        is_edu_header = (
            not block.is_bullet
            and (bool(_DEGREE_PATTERN.search(block.text)) or bool(_YEAR_PATTERN.search(block.text)))
        )

        if is_edu_header:
            if current_blocks:
                title = current_title or "(General)"
                subsections.append((title, current_blocks))
            current_title = block.text
            current_blocks = [block]
        else:
            current_blocks.append(block)

    if current_blocks:
        title = current_title or "(General)"
        subsections.append((title, current_blocks))

    return subsections


# ---------------------------------------------------------------------------
# Sub-section chunker: Technical Skills (Category: items)
# ---------------------------------------------------------------------------

def _chunk_skills_subsections(
    blocks: List[Block],
    section_heading_block: Block,
) -> List[tuple[str, List[Block]]]:
    """
    Split blocks under a Technical Skills section into sub-sections.

    Sub-section header = line where the first ~50 characters contain a ':'.
    Category name = text before ':'.
    Lines without ':' continue the previous category or go to "_uncategorized".
    """
    subsections: List[tuple[str, List[Block]]] = []
    current_title: Optional[str] = None
    current_blocks: List[Block] = []

    for block in blocks:
        if not block.text:
            current_blocks.append(block)
            continue

        # Strip bullet marker for analysis (but keep original text)
        analysis_text = block.text.lstrip()
        for ch in _BULLET_CHARS:
            if analysis_text.startswith(ch):
                analysis_text = analysis_text[len(ch):].lstrip()
                break

        # Check for "Category: items" pattern in first ~50 chars
        colon_pos = analysis_text[:50].find(":")
        if colon_pos > 0:
            category = analysis_text[:colon_pos].strip()
            if category:  # non-empty category name
                if current_blocks:
                    title = current_title or "_uncategorized"
                    subsections.append((title, current_blocks))
                current_title = category
                current_blocks = [block]
                continue

        # No colon — continuation of previous category
        current_blocks.append(block)

    if current_blocks:
        title = current_title or "_uncategorized"
        subsections.append((title, current_blocks))

    return subsections


# ---------------------------------------------------------------------------
# Sub-section chunker: Flat (no sub-sections)
# ---------------------------------------------------------------------------

def _chunk_flat(
    blocks: List[Block],
    section_heading_block: Block,
) -> List[tuple[str, List[Block]]]:
    """Return the entire block range as a single chunk (no sub-section splitting)."""
    all_blocks = [section_heading_block] + blocks
    return [(section_heading_block.text, all_blocks)]


# ===================================================================
# Main parser
# ===================================================================

def _get_section_type(heading_text: str) -> str:
    """
    Determine the section type from its heading text.
    Returns 'date', 'education', 'skills', or 'flat'.
    """
    norm = _normalize_heading_text(heading_text)
    if norm in _DATE_SUBSECTION_TYPES:
        return "date"
    if norm in _EDUCATION_TYPES:
        return "education"
    if norm in _SKILLS_TYPES:
        return "skills"
    return "flat"


def parse_resume_to_json(file_bytes: bytes) -> Dict[str, Any]:
    """
    Parse a .docx resume into the canonical JSON structure.

    Returns a dict with a ``sections`` key — a list of section dicts, each
    containing ``id``, ``title``, ``editable``, ``order``, ``para_start``,
    ``para_end``, ``content`` (concatenated text), and ``paragraphs``
    (per-paragraph text + formatting + is_bullet).
    """
    doc = Document(io.BytesIO(file_bytes))
    paragraphs: List[Paragraph] = list(doc.paragraphs)

    # --- Phase 1: Build Block list ---
    blocks = _build_blocks(paragraphs)
    logger.info("resume_parser: %d paragraphs → %d blocks", len(paragraphs), len(blocks))

    sections: List[Dict[str, Any]] = []
    sec_idx = 0

    # --- Find first section heading ---
    first_heading_idx: Optional[int] = None
    for bi, block in enumerate(blocks):
        if _is_section_heading(block):
            first_heading_idx = bi
            break

    if first_heading_idx is None:
        # No section headings found — treat entire document as one editable section
        logger.warning("No section headings found; treating as single section")
        sections.append(_make_chunk("Full Resume", blocks, sec_idx))
        return {"sections": sections}

    # --- Header chunk (everything before first heading) ---
    if first_heading_idx > 0:
        header_blocks = blocks[:first_heading_idx]
        header_content = "\n".join(b.text for b in header_blocks if b.text)
        if header_content:
            sections.append(_make_chunk("Header", header_blocks, sec_idx, editable=False))
            sec_idx += 1

    # --- Phase 2: Process sections ---
    # First, find all section heading indices to know each section's block range
    heading_indices: List[int] = []
    for bi in range(first_heading_idx, len(blocks)):
        if blocks[bi].text and _is_section_heading(blocks[bi]):
            heading_indices.append(bi)

    for hi, heading_bi in enumerate(heading_indices):
        heading_block = blocks[heading_bi]
        # Content blocks run from heading+1 to next heading (or end)
        content_start = heading_bi + 1
        content_end = heading_indices[hi + 1] if (hi + 1) < len(heading_indices) else len(blocks)
        content_blocks = blocks[content_start:content_end]

        section_type = _get_section_type(heading_block.text)

        if section_type == "date":
            subsections = _chunk_date_subsections(content_blocks, heading_block)
            if len(subsections) <= 1:
                # No meaningful sub-sections — treat as flat with heading included
                all_blocks = [heading_block] + content_blocks
                sections.append(_make_chunk(heading_block.text, all_blocks, sec_idx))
                sec_idx += 1
            else:
                for sub_title, sub_blocks in subsections:
                    sections.append(_make_chunk(sub_title, sub_blocks, sec_idx))
                    sec_idx += 1

        elif section_type == "education":
            subsections = _chunk_education_subsections(content_blocks, heading_block)
            if len(subsections) <= 1:
                all_blocks = [heading_block] + content_blocks
                sections.append(_make_chunk(heading_block.text, all_blocks, sec_idx))
                sec_idx += 1
            else:
                for sub_title, sub_blocks in subsections:
                    sections.append(_make_chunk(sub_title, sub_blocks, sec_idx))
                    sec_idx += 1

        elif section_type == "skills":
            subsections = _chunk_skills_subsections(content_blocks, heading_block)
            if len(subsections) <= 1:
                all_blocks = [heading_block] + content_blocks
                sections.append(_make_chunk(heading_block.text, all_blocks, sec_idx))
                sec_idx += 1
            else:
                for sub_title, sub_blocks in subsections:
                    sections.append(_make_chunk(sub_title, sub_blocks, sec_idx))
                    sec_idx += 1

        else:
            # Flat section (Awards, Certifications, Summary, etc.)
            all_blocks = [heading_block] + content_blocks
            sections.append(_make_chunk(heading_block.text, all_blocks, sec_idx))
            sec_idx += 1

    # Fallback: nothing parsed
    if not sections:
        sections.append(_make_chunk("Full Resume", blocks, sec_idx))

    logger.info(
        "resume_parser: %d sections — %s",
        len(sections),
        [(s["title"][:40], s["editable"], f"paras {s['para_start']}-{s['para_end']}") for s in sections],
    )
    return {"sections": sections}


# ---------------------------------------------------------------------------
# Convenience helpers for downstream consumers (UNCHANGED)
# ---------------------------------------------------------------------------

def get_full_text(parsed_json: Dict[str, Any]) -> str:
    """Concatenate all section content into a single plain-text string."""
    return "\n\n".join(
        sec["content"] for sec in parsed_json["sections"] if sec.get("content")
    )


def get_editable_sections(parsed_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return only sections marked editable."""
    return [sec for sec in parsed_json["sections"] if sec.get("editable", True)]
