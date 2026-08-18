"""One shape for a parsed base resume, whatever the source format.

`locator` is what lets a tailored edit find its way back to the exact place it
came from. For `.docx` it is the paragraph's index in document order, which the
writer uses to edit that paragraph in place. LaTeX does not need it because it
round-trips through `latex_source` instead.

`editable=False` means the tailoring step must never touch this text. The title
block, section headers, and the Education section are frozen so the rendered
document keeps every line in the position the user laid out.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

ROLE_TITLE = "title"
ROLE_HEADER = "header"
ROLE_BULLET = "bullet"
ROLE_LINE = "line"

FROZEN_TITLE = "title block"
FROZEN_HEADER = "section header"
FROZEN_SECTION = "frozen section"
FROZEN_LAYOUT = "layout element"
FROZEN_ALIGNED = "column alignment"
FROZEN_STRUCTURE = "job title or employer line"

# Sections whose text must survive byte-for-byte. Degrees, schools, and dates are
# facts a tailoring model has no business rewording.
FROZEN_SECTION_KEYWORDS = ("education", "certification", "licens")


@dataclass
class ParsedBullet:
    text: str
    latex_source: str = ""
    # The source exactly as uploaded, kept so an edit can be spliced back into the
    # section it came from instead of replacing the whole section.
    latex_original: str = ""
    original_text: str = ""
    locator: Optional[int] = None
    kind: str = ROLE_BULLET
    editable: bool = True
    frozen_reason: str = ""


@dataclass
class ParsedSection:
    name: str
    body_text: str
    latex_source: str = ""
    # The `\section{...}` command on its own, so headers are never rewritten.
    header_latex: str = ""
    bullets: list[ParsedBullet] = field(default_factory=list)
    locator: Optional[int] = None
    editable: bool = True
    frozen_reason: str = ""


@dataclass
class ParsedResume:
    preamble: str
    sections: list[ParsedSection]
    source_format: str = "tex"


def is_frozen_section_name(name: str) -> bool:
    lowered = (name or "").casefold()
    return any(keyword in lowered for keyword in FROZEN_SECTION_KEYWORDS)
