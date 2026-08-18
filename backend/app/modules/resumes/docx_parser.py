"""Parse a .docx resume into sections + bullets without discarding its layout.

Nothing here rebuilds a document. Every paragraph is recorded with its index in
document order (`locator`), and that index is the only thing the writer needs to
put tailored text back into the original file. Tables count too: many resume
templates lay the whole page out in a table, and `lxml`'s document-order walk
reaches those paragraphs in the position they actually appear.

Editability is deliberately conservative. The title block, every section header,
Education, and any paragraph carrying a layout element we cannot safely rewrite
(image, hyperlink, field, manual line break) are frozen.
"""

from __future__ import annotations

import io
import re

from app.modules.resumes.parsed import (
    FROZEN_ALIGNED,
    FROZEN_LAYOUT,
    FROZEN_SECTION,
    FROZEN_STRUCTURE,
    FROZEN_TITLE,
    ROLE_BULLET,
    ROLE_LINE,
    ParsedBullet,
    ParsedResume,
    ParsedSection,
    is_frozen_section_name,
)

# Matching a known section name beats guessing from bold/caps, which every
# template applies differently.
SECTION_VOCABULARY = (
    "summary",
    "objective",
    "profile",
    "professional summary",
    "career summary",
    "highlights",
    "education",
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "relevant experience",
    "industry experience",
    "research experience",
    "teaching experience",
    "internship",
    "internships",
    "projects",
    "academic projects",
    "personal projects",
    "selected projects",
    "skills",
    "technical skills",
    "core skills",
    "core competencies",
    "competencies",
    "technologies",
    "tools",
    "technical proficiencies",
    "certifications",
    "certification",
    "licenses",
    "licenses and certifications",
    "publications",
    "presentations",
    "awards",
    "honors",
    "awards and honors",
    "achievements",
    "activities",
    "leadership",
    "volunteer",
    "volunteering",
    "extracurricular",
    "interests",
    "languages",
    "coursework",
    "relevant coursework",
    "references",
)

_BULLET_GLYPHS = "•▪◦‣·∙-–—*"
_LEADING_GLYPH_RE = re.compile(rf"^[{re.escape(_BULLET_GLYPHS)}]\s+")
_ALIGNMENT_RE = re.compile(r"\t| {3,}")
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_PARA_TAG = f"{_W}p"

# Elements a text-level replacement cannot preserve, so paragraphs holding them
# stay exactly as uploaded.
_UNSAFE_TAGS = (
    f"{_W}drawing",
    f"{_W}pict",
    f"{_W}object",
    f"{_W}hyperlink",
    f"{_W}fldSimple",
    f"{_W}instrText",
    f"{_W}fldChar",
    f"{_W}br",
    f"{_W}footnoteReference",
    f"{_W}endnoteReference",
    "{http://schemas.microsoft.com/office/word/2010/wordml}sym",
)


def _normalize_name(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9 &/]+", " ", (text or "").casefold())
    return re.sub(r"\s+", " ", cleaned).strip()


def iter_paragraphs(document) -> list:
    """Every paragraph in document order, including those inside tables."""
    from docx.text.paragraph import Paragraph

    body = document.element.body
    return [Paragraph(element, document) for element in body.iter(_PARA_TAG)]


def _style_name(paragraph) -> str:
    try:
        return (paragraph.style.name or "") if paragraph.style is not None else ""
    except (KeyError, AttributeError):
        return ""


def _is_list_paragraph(paragraph) -> bool:
    properties = paragraph._p.pPr
    if properties is not None and properties.numPr is not None:
        return True
    style = _style_name(paragraph).casefold()
    return "list" in style or "bullet" in style


def has_column_alignment(text: str) -> bool:
    """True when the line pushes something to the right margin.

    Templates do this with tabs or with a run of spaces, and either way the
    alignment is what keeps a date at the edge of the page. Prose never contains
    three spaces in a row, so this does not catch a normal bullet.
    """
    return bool(_ALIGNMENT_RE.search(text))


def _unsafe_reason(paragraph, text: str) -> str:
    for tag in _UNSAFE_TAGS:
        if paragraph._p.find(f".//{tag}") is not None:
            return FROZEN_LAYOUT
    if has_column_alignment(text):
        return FROZEN_ALIGNED
    return ""


def _is_all_caps(text: str) -> bool:
    letters = [char for char in text if char.isalpha()]
    return bool(letters) and all(char.isupper() for char in letters)


def _is_bold(paragraph) -> bool:
    runs = [run for run in paragraph.runs if run.text.strip()]
    if not runs:
        return False
    return all(run.bold or (run.style is not None and "strong" in (run.style.name or "").casefold()) for run in runs)


_HEADER_MAX_LEN = 45


def _is_confident_header(paragraph, text: str) -> bool:
    """A header we can name with certainty, not one inferred from formatting."""
    if not text or _is_list_paragraph(paragraph):
        return False
    if _normalize_name(text) in SECTION_VOCABULARY:
        return True
    # Templates hand Heading styles to school and employer lines too. A real
    # section header is a short label, never a line with a date pushed right.
    if len(text) > _HEADER_MAX_LEN or has_column_alignment(text):
        return False
    return _style_name(paragraph).casefold().startswith("heading")


def _looks_like_header(paragraph, text: str) -> bool:
    if _is_confident_header(paragraph, text):
        return True
    if not text or _is_list_paragraph(paragraph):
        return False
    # A short standalone line that the template shouts in caps or bold, with no
    # sentence punctuation, is a header in practice.
    if len(text) <= _HEADER_MAX_LEN and not text.endswith((".", ",", ";", ":")) and not has_column_alignment(text):
        return _is_all_caps(text) or _is_bold(paragraph)
    return False


def _is_structural_line(paragraph, text: str) -> bool:
    """A short label-like line: a job title, employer, school, or location.

    These carry facts and hold the vertical rhythm of the page, so they are frozen.
    A skills line is spared because it names a category and then lists it, which
    means a colon or a comma, and those are the lines tailoring must be able to
    touch.
    """
    if _is_list_paragraph(paragraph) or _LEADING_GLYPH_RE.match(text):
        return False
    if len(text) > 60:
        return False
    return ":" not in text and "," not in text


def _bullet_from(paragraph, locator: int, text: str, frozen_reason: str) -> ParsedBullet:
    reason = frozen_reason or _unsafe_reason(paragraph, text)
    if not reason and _is_structural_line(paragraph, text):
        reason = FROZEN_STRUCTURE
    return ParsedBullet(
        text=text,
        original_text=text,
        locator=locator,
        kind=ROLE_BULLET if _is_list_paragraph(paragraph) or _LEADING_GLYPH_RE.match(text) else ROLE_LINE,
        editable=not reason,
        frozen_reason=reason,
    )


def _first_header_index(paragraphs: list) -> int:
    """Where the body starts. Everything above it is the name/contact block.

    Only a confidently named header opens the body, so a bold name line at the top
    is not mistaken for a section and the whole title block stays frozen.
    """
    for index, paragraph in enumerate(paragraphs):
        text = paragraph.text.strip()
        if text and _is_confident_header(paragraph, text):
            return index
    for index, paragraph in enumerate(paragraphs):
        text = paragraph.text.strip()
        if text and _looks_like_header(paragraph, text):
            return index
    return len(paragraphs)


def parse_docx(file_bytes: bytes) -> ParsedResume:
    from docx import Document

    document = Document(io.BytesIO(file_bytes))
    paragraphs = iter_paragraphs(document)
    body_starts = _first_header_index(paragraphs)

    sections: list[ParsedSection] = []
    title = ParsedSection(
        name="Name & contact",
        body_text="",
        locator=None,
        editable=False,
        frozen_reason=FROZEN_TITLE,
    )
    current = title

    for locator, paragraph in enumerate(paragraphs):
        text = paragraph.text.strip()
        if not text:
            continue
        if locator >= body_starts and _looks_like_header(paragraph, text):
            frozen = is_frozen_section_name(text)
            current = ParsedSection(
                name=text,
                body_text="",
                locator=locator,
                editable=not frozen,
                frozen_reason=FROZEN_SECTION if frozen else "",
            )
            sections.append(current)
            continue
        reason = current.frozen_reason if not current.editable else ""
        current.bullets.append(_bullet_from(paragraph, locator, text, reason))

    if title.bullets:
        sections.insert(0, title)
    for section in sections:
        section.body_text = "\n".join(bullet.text for bullet in section.bullets)

    return ParsedResume(preamble="", sections=sections, source_format="docx")


def header_locators(parsed: ParsedResume) -> set[int]:
    """Paragraph indices holding a section header, for a writer-side safety net."""
    return {section.locator for section in parsed.sections if section.locator is not None}


def frozen_locators(parsed: ParsedResume) -> set[int]:
    frozen = header_locators(parsed)
    for section in parsed.sections:
        for bullet in section.bullets:
            if not bullet.editable and bullet.locator is not None:
                frozen.add(bullet.locator)
    return frozen
