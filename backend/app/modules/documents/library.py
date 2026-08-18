"""Save finalized documents into the local resume library.

The library is a plain folder tree on disk, one folder per resume family, so a
tailored resume lands next to the others of its kind and can be picked straight
out of a file dialog while applying.
"""

from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.modules.resumes.models import RESUME_FAMILIES

FAMILY_FOLDERS: dict[str, str] = {
    "ai_ml": "AI ML",
    "data_science": "Data Science",
    "data_analyst": "Data Analyst",
    "business_analyst": "Business Analyst",
}

_UNSAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


@dataclass
class ExportResult:
    directory: str
    docx_path: str | None = None
    pdf_path: str | None = None
    tex_path: str | None = None
    warnings: list[str] = field(default_factory=list)


def family_folder(family: str) -> str:
    """Folder name for a resume family, falling back to a readable form."""
    if family in FAMILY_FOLDERS:
        return FAMILY_FOLDERS[family]
    return (family or "Other").replace("_", " ").title()


def library_dir(family: str, *, create: bool = True) -> str:
    directory = os.path.join(os.path.expanduser(get_settings().resume_library_root), family_folder(family))
    if create:
        os.makedirs(directory, exist_ok=True)
    return directory


def ensure_library() -> dict[str, str]:
    """Create a folder for every family. Returns `{family: path}`."""
    return {family: library_dir(family) for family in RESUME_FAMILIES}


def sanitize(part: str) -> str:
    cleaned = _UNSAFE_FILENAME_RE.sub(" ", part or "")
    return re.sub(r"\s+", " ", cleaned).strip(" .")


def export_stem(original_filename: str, company: str | None, role: str | None, job_id: int) -> str:
    """The uploaded filename, as-is, with the company appended."""
    base = sanitize(os.path.splitext(os.path.basename(original_filename or "resume"))[0]) or "resume"
    suffix = sanitize(company or "") or sanitize(role or "") or f"job {job_id}"
    return f"{base}_{suffix}"


def _place(source: str | None, directory: str, stem: str, extension: str) -> str | None:
    if not source or not os.path.exists(source):
        return None
    target = os.path.join(directory, f"{stem}{extension}")
    if os.path.abspath(source) != os.path.abspath(target):
        shutil.copy2(source, target)
    return target


def export_to_library(
    family: str,
    stem: str,
    *,
    docx_path: str | None = None,
    pdf_path: str | None = None,
    tex_path: str | None = None,
    warnings: list[str] | None = None,
) -> ExportResult:
    directory = library_dir(family)
    return ExportResult(
        directory=directory,
        docx_path=_place(docx_path, directory, stem, ".docx"),
        pdf_path=_place(pdf_path, directory, stem, ".pdf"),
        tex_path=_place(tex_path, directory, stem, ".tex"),
        warnings=list(warnings or []),
    )
