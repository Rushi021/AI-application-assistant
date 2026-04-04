import json
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyResumeRepo
from app.common.errors import not_found
from app.common.resume_parser import get_full_text, parse_resume_to_json
from app.common.utils import compute_sha256
from app.core.config import get_settings
from app.core.deps import get_db, get_request_scope, get_resume_storage
from app.core.security import RequestScope
from app.common.ports import ResumeStorage
from app.modules.applications.models import Application
from app.modules.drafts.models import ResumeDraft, ResumeDraftSection, SectionChatMessage
from app.modules.pipeline.models import PipelineRun
from app.modules.resumes.models import Resume
from app.modules.resumes.schemas import ResumeRead
from app.modules.resumes.scoring import score_resume_against_jd

logger = logging.getLogger(__name__)

MAX_RESUMES_PER_SESSION = 7

router = APIRouter(prefix="/resumes", tags=["resumes"])


def _validate_upload(file: UploadFile, file_bytes: bytes) -> None:
    settings = get_settings()
    ext = (file.filename or "").split(".")[-1].lower()
    if ext not in settings.allowed_extensions_list:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")


def _resume_to_read(item: Resume, storage: ResumeStorage) -> ResumeRead:
    client_stored = item.file_key.startswith("local:")
    if client_stored:
        file_path = f"client://{item.original_filename}"
    else:
        file_path = storage.get_file_url_or_path(item.file_key)
    return ResumeRead(
        id=item.id,
        session_id=item.session_id,
        user_id=item.user_id,
        original_filename=item.original_filename,
        file_key=item.file_key,
        content_type=item.content_type,
        size_bytes=item.size_bytes,
        sha256=item.sha256,
        created_at=item.created_at,
        file_path=file_path,
        client_stored=client_stored,
    )


@router.post("/upload", response_model=ResumeRead)
def upload_resume(
    file: UploadFile = File(...),
    client_stored: bool = Query(
        False,
        description="If true, do not persist the file on the server; only parsed JSON is stored. Requires .docx.",
    ),
    scope: RequestScope = Depends(get_request_scope),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    repo = SqlAlchemyResumeRepo(db)

    if repo.count_by_session(scope.session_id) >= MAX_RESUMES_PER_SESSION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {MAX_RESUMES_PER_SESSION} resumes per session",
        )

    file_bytes = file.file.read()
    _validate_upload(file, file_bytes)

    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    parsed_json_str: Optional[str] = None

    if client_stored:
        if ext != "docx":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="client_stored=true requires a .docx file so the document can be rebuilt without a server-side copy.",
            )
        try:
            parsed = parse_resume_to_json(file_bytes)
            parsed_json_str = json.dumps(parsed)
            logger.info("Client-stored resume: parsed %d sections", len(parsed.get("sections", [])))
        except Exception as e:
            logger.exception("Client-stored resume parse failed")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Could not parse resume: {e!s}",
            ) from e
        file_key = f"local:{uuid.uuid4().hex}"
    else:
        file_key = storage.save_file(file_bytes, file.filename or "resume", file.content_type or "")
        if ext == "docx":
            try:
                parsed = parse_resume_to_json(file_bytes)
                parsed_json_str = json.dumps(parsed)
                logger.info("Parsed resume into %d sections", len(parsed.get("sections", [])))
            except Exception:
                logger.exception("Failed to parse resume at upload (non-fatal)")

    resume = Resume(
        session_id=scope.session_id,
        user_id=scope.user_id,
        original_filename=file.filename or "resume",
        file_key=file_key,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(file_bytes),
        sha256=compute_sha256(file_bytes),
        parsed_json=parsed_json_str,
    )
    created = repo.create(resume)
    return _resume_to_read(created, storage)


@router.get("", response_model=list[ResumeRead])
def list_resumes(
    scope: RequestScope = Depends(get_request_scope),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> list[ResumeRead]:
    repo = SqlAlchemyResumeRepo(db)
    items = repo.list_by_session(scope.session_id)
    return [_resume_to_read(item, storage) for item in items]


@router.get("/{resume_id}", response_model=ResumeRead)
def get_resume(
    resume_id: int,
    scope: RequestScope = Depends(get_request_scope),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    repo = SqlAlchemyResumeRepo(db)
    item = repo.get_by_scope(scope.session_id, resume_id)
    if not item:
        raise not_found("Resume not found")
    return _resume_to_read(item, storage)


@router.delete("/{resume_id}")
def delete_resume(
    resume_id: int,
    force: bool = Query(
        True,
        description="If true, also discard drafts linked to this resume so deletion can proceed.",
    ),
    scope: RequestScope = Depends(get_request_scope),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> Response:
    """Remove a resume from the session. Frees the slot for a new upload."""
    repo = SqlAlchemyResumeRepo(db)
    item = repo.get_by_scope(scope.session_id, resume_id)
    if not item:
        raise not_found("Resume not found")

    # Application rows may reference this resume (extension job tracking). Clear before delete so
    # databases with FK applications.resume_id -> resumes.id do not raise IntegrityError.
    db.query(Application).filter(
        Application.session_id == scope.session_id,
        Application.resume_id == resume_id,
    ).update({Application.resume_id: None}, synchronize_session=False)

    draft_refs = db.query(ResumeDraft).filter(
        ResumeDraft.session_id == scope.session_id,
        ResumeDraft.base_resume_id == resume_id,
    ).all()
    if draft_refs and not force:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot remove resume that is used by a draft. "
                "Discard the draft first (DELETE /drafts/{draft_id}) or retry with ?force=true."
            ),
        )
    if draft_refs and force:
        draft_ids = [d.id for d in draft_refs]
        db.query(SectionChatMessage).filter(
            SectionChatMessage.draft_id.in_(draft_ids),
        ).delete(synchronize_session=False)
        db.query(ResumeDraftSection).filter(
            ResumeDraftSection.draft_id.in_(draft_ids),
        ).delete(synchronize_session=False)
        db.query(ResumeDraft).filter(
            ResumeDraft.id.in_(draft_ids),
        ).delete(synchronize_session=False)

    # Pipeline runs reference resumes.id; remove them before deleting the resume row.
    db.query(PipelineRun).filter(
        PipelineRun.session_id == scope.session_id,
        PipelineRun.resume_id == resume_id,
    ).delete(synchronize_session=False)

    if not item.file_key.startswith("local:"):
        try:
            storage.delete_file(item.file_key)
        except Exception as e:
            logger.warning("Failed to delete resume file %s: %s", item.file_key, e)
    try:
        db.delete(item)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        logger.exception("delete_resume integrity error resume_id=%s", resume_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete resume: it is still referenced. Try again or remove linked drafts/applications.",
        ) from e
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

class ScoreRequest(BaseModel):
    job_description: str
    resume_ids: Optional[List[int]] = None  # If None, score all resumes


class ResumeScoreItem(BaseModel):
    resume_id: int
    original_filename: str
    score: int
    matched_keywords: List[str]
    missing_keywords: List[str]
    rationale: str


class ScoreResponse(BaseModel):
    scores: List[ResumeScoreItem]


@router.post("/score", response_model=ScoreResponse)
def score_resumes(
    payload: ScoreRequest,
    scope: RequestScope = Depends(get_request_scope),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ScoreResponse:
    """Score one or more resumes against a job description. Returns per-resume alignment score."""
    repo = SqlAlchemyResumeRepo(db)

    if payload.resume_ids:
        resumes = [repo.get_by_scope(scope.session_id, rid) for rid in payload.resume_ids]
        resumes = [r for r in resumes if r is not None]
    else:
        resumes = list(repo.list_by_session(scope.session_id))

    if not resumes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No resumes found")

    results: list[ResumeScoreItem] = []
    for resume in resumes:
        try:
            if resume.parsed_json:
                parsed = json.loads(resume.parsed_json)
                resume_text = get_full_text(parsed)
            else:
                # Fallback: parse on the fly if parsed_json is missing
                file_bytes = storage.get_file_bytes(resume.file_key)
                parsed = parse_resume_to_json(file_bytes)
                resume_text = get_full_text(parsed)
        except Exception:
            resume_text = ""

        result = score_resume_against_jd(resume_text, payload.job_description)
        results.append(ResumeScoreItem(
            resume_id=resume.id,
            original_filename=resume.original_filename,
            score=result.score,
            matched_keywords=result.matched_keywords,
            missing_keywords=result.missing_keywords,
            rationale=result.rationale,
        ))

    return ScoreResponse(scores=results)


@router.post("/{resume_id}/reparse", response_model=ResumeRead)
def reparse_resume(
    resume_id: int,
    scope: RequestScope = Depends(get_request_scope),
    storage: ResumeStorage = Depends(get_resume_storage),
    db: Session = Depends(get_db),
) -> ResumeRead:
    """Re-parse an existing resume to update its parsed_json (e.g. after parser improvements)."""
    repo = SqlAlchemyResumeRepo(db)
    resume = repo.get_by_scope(scope.session_id, resume_id)
    if not resume:
        raise not_found("Resume not found")

    file_bytes = storage.get_file_bytes(resume.file_key)
    parsed = parse_resume_to_json(file_bytes)
    resume.parsed_json = json.dumps(parsed)
    db.commit()
    db.refresh(resume)
    logger.info("Re-parsed resume %d into %d sections", resume_id, len(parsed.get("sections", [])))
    return _resume_to_read(resume, storage)
