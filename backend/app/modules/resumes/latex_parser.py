"""Parse a LaTeX resume into preamble + sections + bullets for faithful re-render.

The section command itself (`\\section{Education}`) is split off into
`header_latex` and never handed to the tailoring step, so headers keep their exact
spelling and position. Bullet edits are spliced back into the section's original
source by matching the bullet's untouched `latex_original`, which is what keeps
surrounding macros and spacing intact.
"""

from __future__ import annotations

import re

from app.modules.resumes.parsed import (
    FROZEN_SECTION,
    ParsedBullet,
    ParsedResume,
    ParsedSection,
    is_frozen_section_name,
)

_SECTION_RE = re.compile(
    r"\\(?:section|subsection)\*?\{([^}]*)\}",
    re.IGNORECASE,
)
_ITEM_RE = re.compile(r"\\item\b\s*", re.IGNORECASE)
_BEGIN_DOC = re.compile(r"\\begin\{document\}", re.IGNORECASE)
_END_DOC = re.compile(r"\\end\{document\}", re.IGNORECASE)

_ESCAPES = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def escape_latex_text(text: str) -> str:
    """Escape model-authored prose so it cannot break the document."""
    return "".join(_ESCAPES.get(char, char) for char in text)


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
        source = rf"\item {raw}"
        bullets.append(ParsedBullet(text=_plain_text(raw), latex_source=source, latex_original=source))
    return bullets


def _make_section(name: str, header_latex: str, inner: str) -> ParsedSection:
    frozen = is_frozen_section_name(name)
    return ParsedSection(
        name=name,
        body_text=_plain_text(inner),
        latex_source=inner.strip(),
        header_latex=header_latex,
        bullets=_parse_items(inner),
        editable=not frozen,
        frozen_reason=FROZEN_SECTION if frozen else "",
    )


def parse_latex(source: str) -> ParsedResume:
    begin = _BEGIN_DOC.search(source)
    end = _END_DOC.search(source)
    preamble = source[: begin.start()] if begin else ""
    body = source[begin.end() : end.start() if end else None] if begin else source

    matches = list(_SECTION_RE.finditer(body))
    if not matches:
        return ParsedResume(preamble=preamble, sections=[_make_section("body", "", body)])

    sections: list[ParsedSection] = []
    # Content before the first section is the title/contact block: never tailored.
    lead = body[: matches[0].start()].strip()
    if lead:
        section = _make_section("preamble_body", "", lead)
        section.editable = False
        section.frozen_reason = "title block"
        for bullet in section.bullets:
            bullet.editable = False
            bullet.frozen_reason = "title block"
        sections.append(section)

    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        name = match.group(1).strip() or f"section_{index + 1}"
        section = _make_section(name, match.group(0), body[match.end() : stop])
        if not section.editable:
            for bullet in section.bullets:
                bullet.editable = False
                bullet.frozen_reason = section.frozen_reason
        sections.append(section)
    return ParsedResume(preamble=preamble, sections=sections)


def _section_field(section: ParsedSection | dict, name: str, default: str = "") -> str:
    if isinstance(section, dict):
        return section.get(name) or default
    return getattr(section, name, default) or default


def _section_bullets(section: ParsedSection | dict) -> list:
    if isinstance(section, dict):
        return section.get("bullets") or []
    return section.bullets or []


def _bullet_field(bullet, name: str, default: str = "") -> str:
    if isinstance(bullet, dict):
        return bullet.get(name) or default
    return getattr(bullet, name, default) or default


def _splice_bullets(inner: str, bullets: list) -> str:
    """Replace each edited bullet inside the section's original LaTeX."""
    for bullet in bullets:
        original = _bullet_field(bullet, "latex_original")
        current = _bullet_field(bullet, "latex_source")
        if not original or not current or original == current:
            continue
        if original in inner:
            inner = inner.replace(original, current, 1)
    return inner


def assemble_latex(preamble: str, sections: list[ParsedSection] | list[dict]) -> str:
    """Rebuild a .tex document from stored preamble + section sources."""
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
        header = _section_field(section, "header_latex")
        inner = _section_field(section, "latex_source")
        bullets = _section_bullets(section)
        if inner:
            inner = _splice_bullets(inner, bullets)
        else:
            name = _section_field(section, "name", "Section")
            if not header:
                header = rf"\section{{{name}}}"
            lines: list[str] = []
            if bullets:
                lines.append(r"\begin{itemize}")
                for bullet in bullets:
                    lines.append(_bullet_field(bullet, "latex_source") or rf"\item {_bullet_field(bullet, 'text')}")
                lines.append(r"\end{itemize}")
            elif _section_field(section, "body_text"):
                lines.append(_section_field(section, "body_text"))
            inner = "\n".join(lines)

        chunk = "\n".join(part for part in (header.rstrip(), inner.rstrip()) if part)
        if chunk:
            parts.append(chunk)

    joined = "\n\n".join(parts)
    if "\\end{document}" not in joined:
        joined += "\n\\end{document}\n"
    return joined
