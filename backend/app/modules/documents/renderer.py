"""Assemble tailored sections into .tex and optionally compile to PDF."""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid

from app.common.ports import DocumentRenderer, RenderResult
from app.core.config import get_settings
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
