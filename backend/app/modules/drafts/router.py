"""Draft workflow router: create, get, section chat, patch, apply-section, apply-all."""

import io
import json
import logging
import os

from docx import Document
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.common.adapters.sqlalchemy_repos import SqlAlchemyResumeRepo, SqlAlchemyPipelineRunRepo
from app.common.errors import not_found
from app.common.ports import LLMProvider, ResumeStorage
from app.common.resume_parser import parse_resume_to_json
from app.core.config import get_settings
from app.core.deps import get_db, get_llm_provider, get_request_scope, get_resume_storage
from app.core.security import RequestScope
from app.modules.ai.prompts.section_chat import build_section_chat_prompt
from app.modules.drafts.models import ResumeDraft, ResumeDraftSection
from app.modules.drafts.repos import DraftRepo, DraftSectionRepo, SectionChatRepo
from app.modules.drafts.schemas import (
    ChatMessageRead,
    DraftCreate,
    DraftRead,
    SectionChatRequest,
    SectionChatResponse,
    SectionPatchRequest,
    SectionRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/drafts", tags=["drafts"])


# ---------------------------------------------------------------------------
# Docx reconstruction helpers
# ---------------------------------------------------------------------------

def _copy_run_font(source_font, target_font) -> None:
    """Copy font properties from source to target."""
    for attr in ("bold", "italic", "underline", "size", "name", "color"):
        if hasattr(source_font, attr):
            val = getattr(source_font, attr)
            if val is not None and hasattr(target_font, attr):
                setattr(target_font, attr, val)


def _apply_fmt_to_run(run, fmt: dict) -> None:
    """Apply stored JSON formatting to a docx run."""
    if not fmt:
        return
    if fmt.get("bold") is not None:
        run.bold = fmt["bold"]
    if fmt.get("italic") is not None:
        run.italic = fmt["italic"]
    if fmt.get("underline") is not None:
        run.underline = fmt["underline"]
    if fmt.get("font_name"):
        run.font.name = fmt["font_name"]
    if fmt.get("font_size_pt") is not None:
        from docx.shared import Pt
        run.font.size = Pt(fmt["font_size_pt"])


def _apply_sections_to_docx(
    file_bytes: bytes,
    sections: list,
    parsed_json: dict | None = None,
) -> bytes:
    """
    Apply edited section text back to the original docx, using paragraph
    index ranges (para_start, para_end) stored on each section.

    Uses per-paragraph formatting from parsed_json when available;
    otherwise falls back to copying the first run's font from the original.
    """
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = list(doc.paragraphs)

    # Build a lookup: paragraph_index -> fmt dict from parsed_json
    para_fmt_lookup: dict[int, dict] = {}
    if parsed_json:
        for sec_json in parsed_json.get("sections", []):
            for p in sec_json.get("paragraphs", []):
                para_fmt_lookup[p["idx"]] = p.get("fmt", {})

    for sec in sections:
        if not sec.editable:
            continue

        para_start = sec.para_start
        para_end = sec.para_end
        if para_start is None or para_end is None:
            continue

        # Split section text into lines (one per paragraph in the range)
        lines = sec.current_text.split("\n")
        target_paras = paragraphs[para_start:para_end]

        for pi, para in enumerate(target_paras):
            new_text = lines[pi] if pi < len(lines) else ""
            abs_idx = para_start + pi

            # Skip empty original paragraphs that are just spacing
            if not para.text.strip() and not new_text:
                continue

            # Preserve font from original first run
            first_run = para.runs[0] if para.runs else None
            para.clear()
            new_run = para.add_run(new_text)

            if first_run is not None:
                _copy_run_font(first_run.font, new_run.font)
            elif abs_idx in para_fmt_lookup:
                # Use stored JSON formatting as fallback
                _apply_fmt_to_run(new_run, para_fmt_lookup[abs_idx])

    out = io.BytesIO()
    doc.save(out)
    out.seek(0)
    return out.read()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=DraftRead)
def create_draft(
    payload: DraftCreate,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> DraftRead:
    """
    Create a draft from a base or tailored resume.
    Reads sections from the resume's stored parsed_json.
    """
    resume_repo = SqlAlchemyResumeRepo(db)
    resume = resume_repo.get_by_scope(scope.session_id, payload.base_resume_id)
    if not resume:
        raise not_found("Resume not found")

    # Validate pipeline run if tailored
    if payload.starting_source == "tailored" and payload.run_id:
        run_repo = SqlAlchemyPipelineRunRepo(db)
        run = run_repo.get_by_scope(scope.session_id, payload.run_id)
        if not run or not run.tailored_sections:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pipeline run has no tailored sections",
            )

    # Get canonical JSON sections
    if resume.parsed_json:
        parsed = json.loads(resume.parsed_json)
    else:
        # Fallback: parse on the fly and store for next time
        file_bytes = resume_storage.get_file_bytes(resume.file_key)
        parsed = parse_resume_to_json(file_bytes)
        resume.parsed_json = json.dumps(parsed)
        db.commit()

    raw_sections = parsed.get("sections", [])
    logger.info(
        "Draft create: %d sections from parsed_json (starting_source=%s)",
        len(raw_sections), payload.starting_source,
    )

    # If tailored, overlay tailored text by matching section_id
    if payload.starting_source == "tailored" and payload.run_id:
        run_repo = SqlAlchemyPipelineRunRepo(db)
        run = run_repo.get_by_scope(scope.session_id, payload.run_id)
        if run and run.tailored_sections:
            tailored = json.loads(run.tailored_sections)

            if isinstance(tailored, dict):
                # New format: {section_id: text}
                for sec in raw_sections:
                    if sec.get("editable", True) and sec["id"] in tailored:
                        logger.info(
                            "  Overlay section %s (%s): old=%d chars -> new=%d chars",
                            sec["id"], sec["title"],
                            len(sec.get("content", "")),
                            len(tailored[sec["id"]]),
                        )
                        sec["content"] = tailored[sec["id"]]
                    elif sec.get("editable", True):
                        logger.warning("  Section %s not found in tailored output", sec["id"])
            elif isinstance(tailored, list):
                # Legacy format: flat array — sequential overlay onto editable sections
                logger.warning("Using legacy flat-array tailored_sections overlay")
                editable_idx = 0
                for sec in raw_sections:
                    if sec.get("editable", True) and editable_idx < len(tailored):
                        sec["content"] = tailored[editable_idx]
                        editable_idx += 1

    # Create draft record
    draft_repo = DraftRepo(db)
    draft = ResumeDraft(
        session_id=scope.session_id,
        user_id=scope.user_id,
        run_id=payload.run_id,
        base_resume_id=payload.base_resume_id,
        starting_source=payload.starting_source,
        status="drafting",
        job_description=payload.job_description,
    )
    created_draft = draft_repo.create(draft)

    # Create section records from JSON
    section_repo = DraftSectionRepo(db)
    section_models = [
        ResumeDraftSection(
            draft_id=created_draft.id,
            section_id=sec["id"],
            section_title=sec["title"],
            order_index=sec["order"],
            original_text=sec.get("content", ""),
            current_text=sec.get("content", ""),
            editable=sec.get("editable", True),
            para_start=sec.get("para_start"),
            para_end=sec.get("para_end"),
        )
        for sec in raw_sections
    ]
    created_sections = section_repo.create_many(section_models)

    return DraftRead(
        id=created_draft.id,
        session_id=created_draft.session_id,
        run_id=created_draft.run_id,
        base_resume_id=created_draft.base_resume_id,
        starting_source=created_draft.starting_source,
        status=created_draft.status,
        job_description=created_draft.job_description,
        created_at=created_draft.created_at,
        updated_at=created_draft.updated_at,
        sections=[SectionRead.model_validate(s) for s in created_sections],
    )


@router.get("/{draft_id}", response_model=DraftRead)
def get_draft(
    draft_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> DraftRead:
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    sections = section_repo.list_by_draft(draft_id)

    return DraftRead(
        id=draft.id,
        session_id=draft.session_id,
        run_id=draft.run_id,
        base_resume_id=draft.base_resume_id,
        starting_source=draft.starting_source,
        status=draft.status,
        job_description=draft.job_description,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        sections=[SectionRead.model_validate(s) for s in sections],
    )


@router.post("/{draft_id}/sections/{section_id}/chat", response_model=SectionChatResponse)
def chat_section(
    draft_id: int,
    section_id: str,
    payload: SectionChatRequest,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
) -> SectionChatResponse:
    """Per-section chat: user sends instruction, LLM returns revised text."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    section = section_repo.get_section(draft_id, section_id)
    if not section:
        raise not_found("Section not found")

    if not section.editable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This section is not editable",
        )

    # Record feedback if provided
    if payload.user_feedback:
        section_repo.set_feedback(draft_id, section_id, payload.user_feedback)

    chat_repo = SectionChatRepo(db)

    # Save user message
    chat_repo.add_message(draft_id, section_id, "user", payload.message)

    # Get history for context
    history = chat_repo.get_history(draft_id, section_id)
    history_for_prompt = history[:-1] if payload.include_history else []

    # Build prompt
    prompt = build_section_chat_prompt(
        section_title=section.section_title,
        current_text=section.current_text,
        job_description=draft.job_description,
        user_message=payload.message,
        user_feedback=payload.user_feedback,
        history=history_for_prompt,
    )

    try:
        revised_text = llm.generate(prompt)
    except Exception as e:
        logger.exception("Section chat LLM call failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM failed: {type(e).__name__}: {e!s}",
        ) from e

    # Save assistant response
    chat_repo.add_message(draft_id, section_id, "assistant", revised_text)

    # Update proposed_text
    section_repo.update_proposed(draft_id, section_id, revised_text)

    return SectionChatResponse(
        proposed_text=revised_text,
        assistant_message=revised_text,
    )


@router.patch("/{draft_id}/sections/{section_id}", response_model=SectionRead)
def patch_section(
    draft_id: int,
    section_id: str,
    payload: SectionPatchRequest,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> SectionRead:
    """Manual inline edit: replace current_text directly."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    updated = section_repo.update_current_text(draft_id, section_id, payload.current_text)
    if not updated:
        raise not_found("Section not found")

    # Record in chat history for traceability
    chat_repo = SectionChatRepo(db)
    chat_repo.add_message(
        draft_id, section_id, "system",
        "[Manual edit] User updated section text directly.",
    )

    return SectionRead.model_validate(updated)


@router.post("/{draft_id}/sections/{section_id}/apply", response_model=SectionRead)
def apply_section(
    draft_id: int,
    section_id: str,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> SectionRead:
    """Accept the proposed text for this section."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    updated = section_repo.accept_proposed(draft_id, section_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No proposed text to apply for this section",
        )
    return SectionRead.model_validate(updated)


@router.post("/{draft_id}/apply-all", response_class=Response)
def apply_all(
    draft_id: int,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
    resume_storage: ResumeStorage = Depends(get_resume_storage),
) -> Response:
    """
    Finalize the draft: generate docx with all current_text applied,
    preserving the original Word formatting.
    Uses paragraph ranges (para_start, para_end) for precise mapping,
    with JSON formatting as a fallback.
    """
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    section_repo = DraftSectionRepo(db)
    sections = section_repo.list_by_draft(draft_id)
    if not sections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Draft has no sections",
        )

    # Load original resume docx
    resume_repo = SqlAlchemyResumeRepo(db)
    resume = resume_repo.get_by_scope(scope.session_id, draft.base_resume_id)
    if not resume:
        raise not_found("Base resume not found")

    # Load parsed_json for formatting reference
    parsed_json = json.loads(resume.parsed_json) if resume.parsed_json else None

    file_bytes = resume_storage.get_file_bytes(resume.file_key)
    out_bytes = _apply_sections_to_docx(file_bytes, sections, parsed_json)

    # Mark draft as approved
    draft_repo.update_status(scope.session_id, draft_id, "approved")

    filename = f"final_{resume.original_filename}"
    if not filename.lower().endswith(".docx"):
        filename += ".docx"

    # Auto-save to local output directory
    settings = get_settings()
    output_dir = settings.output_resume_path
    os.makedirs(output_dir, exist_ok=True)
    save_path = os.path.join(output_dir, filename)
    with open(save_path, "wb") as f:
        f.write(out_bytes)
    logger.info("Saved tailored resume to %s", save_path)

    return Response(
        content=out_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{draft_id}/sections/{section_id}/history", response_model=list[ChatMessageRead])
def get_section_history(
    draft_id: int,
    section_id: str,
    scope: RequestScope = Depends(get_request_scope),
    db: Session = Depends(get_db),
) -> list[ChatMessageRead]:
    """Get the full chat history for a section."""
    draft_repo = DraftRepo(db)
    draft = draft_repo.get_by_scope(scope.session_id, draft_id)
    if not draft:
        raise not_found("Draft not found")

    chat_repo = SectionChatRepo(db)
    messages = chat_repo.get_history(draft_id, section_id)
    return [ChatMessageRead.model_validate(m) for m in messages]
