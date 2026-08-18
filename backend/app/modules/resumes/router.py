from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyResumeRepo, SqlAlchemyResumeSectionRepo
from app.common.errors import bad_request, not_found
from app.common.ports import ResumeStorage
from app.common.utils import compute_sha256
from app.core.config import get_settings
from app.core.deps import get_current_user, get_db, get_resume_storage
from app.modules.resumes.docx_parser import parse_docx
from app.modules.resumes.latex_parser import parse_latex
from app.modules.resumes.models import RESUME_FAMILIES, Resume, ResumeBullet, ResumeSection
from app.modules.resumes.schemas import BulletRead, ResumeRead, SectionRead

router = APIRouter(prefix="/resumes", tags=["resumes"])


def _validate_upload(file: UploadFile, file_bytes: bytes) -> str:
    settings = get_settings()
    ext = (file.filename or "").split(".")[-1].lower()
    if ext not in settings.allowed_extensions_list:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
    return ext


def _to_read(item: Resume, storage: ResumeStorage, db: Session) -> ResumeRead:
    sections = SqlAlchemyResumeSectionRepo(db).list_sections(item.id)
    return ResumeRead(
        id=item.id,
        user_id=item.user_id,
        original_filename=item.original_filename,
        file_key=item.file_key,
        content_type=item.content_type,
        size_bytes=item.size_bytes,
        sha256=item.sha256,
        family=item.family,
        version=item.version,
        is_active=item.is_active,
        source_format=item.source_format,
        created_at=item.created_at,
        file_path=storage.get_file_url_or_path(item.file_key),
        sections=[
            SectionRead(
                id=section.id,
                name=section.name,
                order_index=section.order_index,
                body_text=section.body_text,
                latex_source=section.latex_source,
                bullets=[BulletRead.model_validate(b) for b in section.bullets],
            )
            for section in sections
        ],
    )


def _persist_parse(db: Session, resume_id: int, parsed) -> None:
    sections: list[ResumeSection] = []
    bullets: list[ResumeBullet] = []
    for index, parsed_section in enumerate(parsed.sections):
        section = ResumeSection(
            resume_id=resume_id,
            name=parsed_section.name,
            order_index=index,
            body_text=parsed_section.body_text,
            latex_source=parsed_section.latex_source,
        )
        sections.append(section)
    SqlAlchemyResumeSectionRepo(db).replace_for_resume(resume_id, sections, [])
    stored = SqlAlchemyResumeSectionRepo(db).list_sections(resume_id)
    bullets = []
    for section, parsed_section in zip(stored, parsed.sections):
        for b_index, parsed_bullet in enumerate(parsed_section.bullets):
            bullets.append(
                ResumeBullet(
                    section_id=section.id,
                    order_index=b_index,
                    text=parsed_bullet.text,
                    latex_source=parsed_bullet.latex_source,
                )
            )
    if bullets:
        db.add_all(bullets)
        db.commit()


@router.post("/upload", response_model=ResumeRead)
def upload_resume(
    file: UploadFile = File(...),
    family: str = Form(...),
    version: int = Form(1),
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    if family not in RESUME_FAMILIES:
        raise bad_request(f"family must be one of {RESUME_FAMILIES}")
    if version not in (1, 2):
        raise bad_request("version must be 1 or 2")
    file_bytes = file.file.read()
    ext = _validate_upload(file, file_bytes)

    repo = SqlAlchemyResumeRepo(db)
    existing = repo.get_by_family_version(current_user.id, family, version)
    if existing:
        raise bad_request(
            f"A {family} v{version} resume already exists (id={existing.id}). Delete it first."
        )

    file_key = storage.save_file(file_bytes, file.filename or "resume", file.content_type or "")
    source_format = "tex" if ext == "tex" else ext
    preamble = None
    parsed = None
    if ext == "tex":
        parsed = parse_latex(file_bytes.decode("utf-8", errors="replace"))
        preamble = parsed.preamble
    elif ext == "docx":
        try:
            parsed = parse_docx(file_bytes)
        except Exception as exc:  # a corrupt upload should not 500
            raise bad_request(f"Could not read that .docx: {exc}")

    resume = Resume(
        user_id=current_user.id,
        original_filename=file.filename or "resume",
        file_key=file_key,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(file_bytes),
        sha256=compute_sha256(file_bytes),
        family=family,
        version=version,
        is_active=True,
        source_format=source_format,
        template_preamble=preamble,
    )
    created = repo.create(resume)
    if parsed is not None:
        _persist_parse(db, created.id, parsed)
    else:
        blob = ResumeSection(
            resume_id=created.id,
            name="body",
            order_index=0,
            body_text="",
            latex_source="",
        )
        SqlAlchemyResumeSectionRepo(db).replace_for_resume(created.id, [blob], [])
    return _to_read(created, storage, db)


def _parse_bytes(ext: str, file_bytes: bytes):
    if ext == "tex":
        return parse_latex(file_bytes.decode("utf-8", errors="replace"))
    if ext == "docx":
        return parse_docx(file_bytes)
    return None


@router.post("/{resume_id}/reparse", response_model=ResumeRead)
def reparse_resume(
    resume_id: int,
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    """Re-run the parser over a stored upload without re-uploading it.

    Useful after a parser improvement: the file on disk is the source of truth, so
    the sections and bullets scoring reads can be rebuilt from it at any time.
    """
    repo = SqlAlchemyResumeRepo(db)
    item = repo.get(resume_id)
    if not item or item.user_id != current_user.id:
        raise not_found("Resume not found")
    with open(storage.get_file_url_or_path(item.file_key), "rb") as handle:
        file_bytes = handle.read()
    parsed = _parse_bytes(item.source_format, file_bytes)
    if parsed is None:
        raise bad_request(f"No parser for .{item.source_format} resumes")
    if parsed.preamble:
        item.template_preamble = parsed.preamble
    _persist_parse(db, item.id, parsed)
    db.commit()
    return _to_read(item, storage, db)


@router.get("", response_model=list[ResumeRead])
def list_resumes(
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> list[ResumeRead]:
    items = SqlAlchemyResumeRepo(db).list_by_user(current_user.id)
    return [_to_read(item, storage, db) for item in items]


@router.get("/{resume_id}", response_model=ResumeRead)
def get_resume(
    resume_id: int,
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    item = SqlAlchemyResumeRepo(db).get(resume_id)
    if not item or item.user_id != current_user.id:
        raise not_found("Resume not found")
    return _to_read(item, storage, db)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(
    resume_id: int,
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> None:
    repo = SqlAlchemyResumeRepo(db)
    item = repo.get(resume_id)
    if not item or item.user_id != current_user.id:
        raise not_found("Resume not found")
    storage.delete_file(item.file_key)
    repo.delete(resume_id)
