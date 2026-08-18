"""Convert a .docx to PDF using whatever converter the machine actually has.

Neither converter is a Python dependency, so this always degrades to a warning
rather than failing an export: the .docx is the deliverable, the PDF is a bonus.

`auto` uses LibreOffice only. Word is opt-in (`DOCX_PDF_CONVERTER=word`) because
driving it over AppleScript blocks on any dialog it decides to show — a stalled
apply flow is worse than no PDF.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

_SOFFICE_NAMES = ("soffice", "libreoffice")
_WORD_APP = "/Applications/Microsoft Word.app"

# Word needs absolute POSIX paths, and must not be focus-stolen or quit out from
# under a user who already had it open.
_WORD_SCRIPT = """
tell application "Microsoft Word"
    set wasRunning to running
    open (POSIX file "{src}")
    set theDoc to active document
    save as theDoc file name "{dst}" file format format PDF
    close theDoc saving no
    if not wasRunning then quit saving no
end tell
"""


def _find_soffice() -> str | None:
    for name in _SOFFICE_NAMES:
        found = shutil.which(name)
        if found:
            return found
    bundled = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    return bundled if os.path.exists(bundled) else None


def _via_soffice(binary: str, docx_path: str, out_dir: str) -> tuple[str | None, str | None]:
    try:
        subprocess.run(
            [binary, "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            check=True,
            capture_output=True,
            timeout=180,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return None, f"LibreOffice PDF conversion failed: {exc}"
    produced = os.path.join(out_dir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    if not os.path.exists(produced):
        return None, "LibreOffice finished but produced no PDF."
    return produced, None


def _via_word(docx_path: str, pdf_path: str) -> tuple[str | None, str | None]:
    if sys.platform != "darwin" or not os.path.exists(_WORD_APP):
        return None, None
    script = _WORD_SCRIPT.format(src=docx_path, dst=pdf_path)
    try:
        subprocess.run(["osascript", "-e", script], check=True, capture_output=True, timeout=90)
    except subprocess.TimeoutExpired:
        return None, "Word did not respond within 90s (a dialog may be waiting). Wrote .docx only."
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        detail = getattr(exc, "stderr", b"") or b""
        return None, f"Word PDF conversion failed: {detail.decode(errors='replace').strip() or exc}"
    if not os.path.exists(pdf_path):
        return None, "Word finished but produced no PDF."
    return pdf_path, None


def docx_to_pdf(docx_path: str, pdf_path: str, *, converter: str = "auto") -> tuple[str | None, str | None]:
    """Return `(pdf_path, warning)`. Exactly one of the two is set."""
    if converter == "off":
        return None, None
    # Both converters are external processes with their own working directory.
    docx_path = os.path.abspath(docx_path)
    pdf_path = os.path.abspath(pdf_path)
    out_dir = os.path.dirname(pdf_path) or "."
    os.makedirs(out_dir, exist_ok=True)

    attempts: list[str] = []
    if converter in ("auto", "soffice"):
        binary = _find_soffice()
        if binary:
            produced, warning = _via_soffice(binary, docx_path, out_dir)
            if produced:
                if produced != pdf_path:
                    shutil.move(produced, pdf_path)
                    produced = pdf_path
                return produced, None
            if warning:
                attempts.append(warning)
        else:
            attempts.append("LibreOffice (soffice) is not installed.")

    if converter == "word":
        produced, warning = _via_word(docx_path, pdf_path)
        if produced:
            return produced, None
        if warning:
            attempts.append(warning)

    hint = (
        "No PDF written. Install LibreOffice (brew install --cask libreoffice) for headless "
        "conversion, or set DOCX_PDF_CONVERTER=word once Word is allowed to be automated."
    )
    return None, " ".join(attempts + [hint])
