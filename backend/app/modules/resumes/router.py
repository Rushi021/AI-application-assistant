from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyResumeRepo
from app.common.errors import not_found
from app.common.utils import compute_sha256
from app.core.config import get_settings
from app.core.deps import get_current_user, get_db, get_resume_storage
from app.common.ports import ResumeStorage
from app.modules.resumes.models import Resume
from app.modules.resumes.schemas import ResumeRead


router = APIRouter(prefix="/resumes", tags=["resumes"])


def _validate_upload(file: UploadFile, file_bytes: bytes) -> None:
    settings = get_settings()
    ext = (file.filename or "").split(".")[-1].lower()
    if ext not in settings.allowed_extensions_list:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")


@router.post("/upload", response_model=ResumeRead)
def upload_resume(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    file_bytes = file.file.read()
    _validate_upload(file, file_bytes)

    file_key = storage.save_file(file_bytes, file.filename or "resume", file.content_type or "")

    resume = Resume(
        user_id=current_user.id,
        original_filename=file.filename or "resume",
        file_key=file_key,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(file_bytes),
        sha256=compute_sha256(file_bytes),
    )
    repo = SqlAlchemyResumeRepo(db)
    created = repo.create(resume)

    return ResumeRead(
        id=created.id,
        user_id=created.user_id,
        original_filename=created.original_filename,
        file_key=created.file_key,
        content_type=created.content_type,
        size_bytes=created.size_bytes,
        sha256=created.sha256,
        created_at=created.created_at,
        file_path=storage.get_file_url_or_path(created.file_key),
    )


@router.get("", response_model=list[ResumeRead])
def list_resumes(
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> list[ResumeRead]:
    repo = SqlAlchemyResumeRepo(db)
    items = repo.list_by_user(current_user.id)
    return [
        ResumeRead(
            id=item.id,
            user_id=item.user_id,
            original_filename=item.original_filename,
            file_key=item.file_key,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            sha256=item.sha256,
            created_at=item.created_at,
            file_path=storage.get_file_url_or_path(item.file_key),
        )
        for item in items
    ]


@router.get("/{resume_id}", response_model=ResumeRead)
def get_resume(
    resume_id: int,
    current_user=Depends(get_current_user),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    repo = SqlAlchemyResumeRepo(db)
    item = repo.get(resume_id)
    if not item or item.user_id != current_user.id:
        raise not_found("Resume not found")
    return ResumeRead(
        id=item.id,
        user_id=item.user_id,
        original_filename=item.original_filename,
        file_key=item.file_key,
        content_type=item.content_type,
        size_bytes=item.size_bytes,
        sha256=item.sha256,
        created_at=item.created_at,
        file_path=storage.get_file_url_or_path(item.file_key),
    )
