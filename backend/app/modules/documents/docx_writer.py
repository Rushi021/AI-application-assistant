"""Write tailored text back into the uploaded .docx.

The uploaded file *is* the template. We open it and swap text inside the runs that
are already there, so nothing is ever rebuilt: paragraph properties (indentation,
spacing, alignment, list numbering, tab stops) and run properties (font, size,
bold, colour) are carried over because they are never touched.

Within a paragraph we only rewrite the span that actually changed. The runs
covering the unchanged head and tail are left alone, which is what keeps inline
formatting — a bolded skill label, an italic tool name — exactly where it was.

Two invariants are enforced at write time rather than trusted upstream:

* a locator listed as frozen is never written, so headers, the title block, and
  Education cannot drift even if a caller passes an edit for them;
* a line that pushes text to the right margin, with tabs or with runs of spaces,
  is never rewritten, because re-flowing it would move the date it aligns.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass, field

from app.modules.resumes.docx_parser import has_column_alignment, iter_paragraphs


@dataclass
class DocxWriteResult:
    path: str
    applied: int = 0
    refused: list[str] = field(default_factory=list)


def _common_prefix_len(old: str, new: str) -> int:
    limit = min(len(old), len(new))
    index = 0
    while index < limit and old[index] == new[index]:
        index += 1
    return index


def _common_suffix_len(old: str, new: str, prefix: int) -> int:
    limit = min(len(old), len(new)) - prefix
    count = 0
    while count < limit and old[len(old) - 1 - count] == new[len(new) - 1 - count]:
        count += 1
    return count


def _splice_runs(runs: list, old: str, new: str) -> None:
    """Replace only the changed span, leaving untouched runs formatted as they were."""
    prefix = _common_prefix_len(old, new)
    suffix = _common_suffix_len(old, new, prefix)
    change_start = prefix
    change_end = len(old) - suffix
    middle = new[prefix : len(new) - suffix]

    spans = []
    offset = 0
    for run in runs:
        length = len(run.text)
        spans.append((run, offset, offset + length))
        offset += length

    if change_start == change_end:
        # Pure insertion: drop it into whichever run owns that offset.
        target = next(
            (span for span in spans if span[1] <= change_start <= span[2] and span[2] > span[1]),
            spans[-1],
        )
        run, start, _ = target
        cut = change_start - start
        run.text = run.text[:cut] + middle + run.text[cut:]
        return

    placed = False
    for run, start, end in spans:
        if end <= change_start or start >= change_end:
            continue
        head = run.text[: max(0, change_start - start)]
        tail = run.text[change_end - start :] if change_end < end else ""
        if placed:
            run.text = head + tail
        else:
            run.text = head + middle + tail
            placed = True


def _paragraph_runs_text(paragraph) -> str:
    return "".join(run.text for run in paragraph.runs)


def write_docx(
    original_bytes: bytes,
    edits: dict[int, str],
    out_path: str,
    *,
    frozen: set[int] | None = None,
) -> DocxWriteResult:
    """Apply `{paragraph locator: new text}` to a copy of the original document."""
    from docx import Document

    document = Document(io.BytesIO(original_bytes))
    paragraphs = iter_paragraphs(document)
    result = DocxWriteResult(path=out_path)
    frozen = frozen or set()

    for locator, new_text in edits.items():
        if locator in frozen:
            result.refused.append(f"paragraph {locator}: frozen, left as uploaded")
            continue
        if locator < 0 or locator >= len(paragraphs):
            result.refused.append(f"paragraph {locator}: out of range")
            continue
        paragraph = paragraphs[locator]
        runs = paragraph.runs
        if not runs:
            result.refused.append(f"paragraph {locator}: no runs to write into")
            continue
        old_text = _paragraph_runs_text(paragraph)
        new_text = new_text.replace("\r\n", " ").replace("\n", " ").strip()
        if not new_text or new_text == old_text.strip():
            continue
        if has_column_alignment(old_text):
            result.refused.append(
                f"paragraph {locator}: right-aligned by tabs or spacing, left as uploaded"
            )
            continue
        # Keep whatever leading whitespace the template used for this line.
        lead = old_text[: len(old_text) - len(old_text.lstrip())]
        trail = old_text[len(old_text.rstrip()) :]
        candidate = f"{lead}{new_text}{trail}"
        _splice_runs(runs, old_text, candidate)
        result.applied += 1

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    from app.modules.documents.cover import save_package
    save_package(original_bytes, document, out_path)
    return result
