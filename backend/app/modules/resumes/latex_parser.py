"""Parse a LaTeX resume into preamble + sections + bullets for faithful re-render."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SECTION_RE = re.compile(
    r"\\(?:section|subsection)\*?\{([^}]*)\}",
    re.IGNORECASE,
)
_ITEM_RE = re.compile(r"\\item\b\s*", re.IGNORECASE)
_BEGIN_DOC = re.compile(r"\\begin\{document\}", re.IGNORECASE)
_END_DOC = re.compile(r"\\end\{document\}", re.IGNORECASE)


@dataclass
class ParsedBullet:
    text: str
    latex_source: str


@dataclass
class ParsedSection:
    name: str
    body_text: str
    latex_source: str
    bullets: list[ParsedBullet] = field(default_factory=list)


@dataclass
class ParsedResume:
    preamble: str
    sections: list[ParsedSection]
    source_format: str = "tex"


def _plain_text(latex: str) -> str:
    text = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?", " ", latex)
    text = re.sub(r"[{}%~]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_items(block: str) -> list[ParsedBullet]:
    parts = _ITEM_RE.split(block)
    bullets: list[ParsedBullet] = []
    for part in parts[1:]:
        raw = part.strip()
        if not raw:
            continue
        # Trim trailing env closers so the bullet source stays pasteable.
        raw = re.sub(r"\\end\{(?:itemize|enumerate)\}.*$", "", raw, flags=re.DOTALL | re.IGNORECASE).strip()
        if not raw:
            continue
        bullets.append(ParsedBullet(text=_plain_text(raw), latex_source=rf"\item {raw}"))
    return bullets


def parse_latex(source: str) -> ParsedResume:
    begin = _BEGIN_DOC.search(source)
    end = _END_DOC.search(source)
    preamble = source[: begin.start()] if begin else ""
    body = source[begin.end() : end.start() if end else None] if begin else source

    matches = list(_SECTION_RE.finditer(body))
    if not matches:
        bullets = _parse_items(body)
        section = ParsedSection(
            name="body",
            body_text=_plain_text(body),
            latex_source=body.strip(),
            bullets=bullets,
        )
        return ParsedResume(preamble=preamble, sections=[section])

    sections: list[ParsedSection] = []
    # Content before the first section is kept as a lead-in section if non-empty.
    lead = body[: matches[0].start()].strip()
    if lead:
        sections.append(
            ParsedSection(
                name="preamble_body",
                body_text=_plain_text(lead),
                latex_source=lead,
                bullets=_parse_items(lead),
            )
        )

    for index, match in enumerate(matches):
        start = match.start()
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        chunk = body[start:stop].strip()
        inner = body[match.end() : stop]
        sections.append(
            ParsedSection(
                name=match.group(1).strip() or f"section_{index + 1}",
                body_text=_plain_text(inner),
                latex_source=chunk,
                bullets=_parse_items(inner),
            )
        )
    return ParsedResume(preamble=preamble, sections=sections)


def assemble_latex(preamble: str, sections: list[ParsedSection] | list[dict]) -> str:
    """Rebuild a .tex document from stored preamble + section latex_source."""
    parts: list[str] = []
    preamble = (preamble or "").rstrip()
    if preamble:
        parts.append(preamble)
        if "\\begin{document}" not in preamble:
            parts.append("\\begin{document}")
    else:
        parts.append("\\documentclass{article}")
        parts.append("\\begin{document}")

    for section in sections:
        if isinstance(section, dict):
            source = section.get("latex_source") or ""
            if not source:
                name = section.get("name") or "Section"
                bullets = section.get("bullets") or []
                body_lines = [rf"\section{{{name}}}"]
                if bullets:
                    body_lines.append(r"\begin{itemize}")
                    for bullet in bullets:
                        text = bullet.get("text") if isinstance(bullet, dict) else str(bullet)
                        body_lines.append(rf"\item {text}")
                    body_lines.append(r"\end{itemize}")
                elif section.get("body_text"):
                    body_lines.append(section["body_text"])
                source = "\n".join(body_lines)
        else:
            source = section.latex_source
        if source:
            parts.append(source.rstrip())

    joined = "\n\n".join(parts)
    if "\\end{document}" not in joined:
        joined += "\n\\end{document}\n"
    return joined
