"""Render tailored sections back into the base resume's own format.

LaTeX resumes are reassembled from the stored preamble and per-section source.
DOCX resumes are never reassembled: the upload is edited in place so its layout is
carried over byte-for-byte outside the lines that changed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from typing import Optional

from app.common.ports import DocumentRenderer, RenderResult
from app.core.config import get_settings
from app.modules.documents.docx_writer import write_docx
from app.modules.documents.pdf import docx_to_pdf
from app.modules.resumes.latex_parser import assemble_latex


class LatexPdfRenderer(DocumentRenderer):
    def __init__(self) -> None:
        settings = get_settings()
        self._output_dir = settings.output_dir
        self._compiler = settings.latex_compiler
        os.makedirs(self._output_dir, exist_ok=True)

    def render(self, latex: str, output_stem: str) -> RenderResult:
        stem = output_stem or uuid.uuid4().hex
        tex_path = os.path.join(self._output_dir, f"{stem}.tex")
        with open(tex_path, "w", encoding="utf-8") as handle:
            handle.write(latex)

        compiler = self._resolve_compiler()
        if compiler is None:
            return RenderResult(
                tex_path=tex_path,
                pdf_path=None,
                compiler=None,
                warning="No LaTeX compiler found (tectonic/pdflatex). Wrote .tex only.",
            )
        pdf_path = os.path.join(self._output_dir, f"{stem}.pdf")
        try:
            if compiler.endswith("pdflatex") or compiler == "pdflatex":
                subprocess.run(
                    [compiler, "-interaction=nonstopmode", "-output-directory", self._output_dir, tex_path],
                    check=True,
                    capture_output=True,
                    timeout=60,
                )
            else:
                subprocess.run(
                    [compiler, f"--outdir={self._output_dir}", tex_path],
                    check=True,
                    capture_output=True,
                    timeout=60,
                )
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
            return RenderResult(
                tex_path=tex_path,
                pdf_path=None,
                compiler=compiler,
                warning=f"LaTeX compile failed ({compiler}): {exc}. Wrote .tex only.",
            )
        if not os.path.exists(pdf_path):
            return RenderResult(
                tex_path=tex_path,
                pdf_path=None,
                compiler=compiler,
                warning="Compiler finished but PDF was not produced. Wrote .tex only.",
            )
        return RenderResult(tex_path=tex_path, pdf_path=pdf_path, compiler=compiler)

    def _resolve_compiler(self) -> str | None:
        preferred = self._compiler
        if preferred and shutil.which(preferred):
            return preferred
        for name in ("tectonic", "pdflatex"):
            path = shutil.which(name)
            if path:
                return path
        return None


def render_from_sections(preamble: str, sections: list[dict], stem: str) -> RenderResult:
    latex = assemble_latex(preamble, sections)
    return LatexPdfRenderer().render(latex, stem)


@dataclass
class DocxRenderResult:
    docx_path: str
    pdf_path: Optional[str]
    warning: Optional[str] = None


def render_docx_from_sections(
    original_bytes: bytes,
    sections: list[dict],
    stem: str,
) -> DocxRenderResult:
    """Edit the uploaded .docx in place and try to produce a PDF next to it.

    Only paragraphs whose text actually changed are written, and the writer refuses
    any locator the parser marked frozen, so the header/title/Education layout is
    guaranteed to match the upload.
    """
    settings = get_settings()
    output_dir = settings.output_dir
    os.makedirs(output_dir, exist_ok=True)

    edits, frozen = collect_docx_edits(sections)
    docx_path = os.path.join(output_dir, f"{stem}.docx")
    written = write_docx(original_bytes, edits, docx_path, frozen=frozen)

    pdf_path, warning = docx_to_pdf(
        docx_path,
        os.path.join(output_dir, f"{stem}.pdf"),
        converter=settings.docx_pdf_converter,
    )
    warnings = [warning] if warning else []
    warnings.extend(written.refused)
    return DocxRenderResult(
        docx_path=docx_path,
        pdf_path=pdf_path,
        warning=" | ".join(warnings) or None,
    )


def collect_docx_edits(sections: list[dict]) -> tuple[dict[int, str], set[int]]:
    """Split a tailor-run snapshot into `{locator: new text}` and frozen locators."""
    edits: dict[int, str] = {}
    frozen: set[int] = set()
    for section in sections:
        header = section.get("locator")
        if header is not None:
            frozen.add(int(header))
        for bullet in section.get("bullets") or []:
            locator = bullet.get("locator")
            if locator is None:
                continue
            locator = int(locator)
            if not bullet.get("editable", True):
                frozen.add(locator)
                continue
            text = (bullet.get("text") or "").strip()
            original = (bullet.get("original_text") or "").strip()
            if text and text != original:
                edits[locator] = text
    return edits, frozen
