"""SQLAlchemy repos for the draft workflow. All queries scoped by session_id."""

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.modules.drafts.models import ResumeDraft, ResumeDraftSection, SectionChatMessage


class DraftRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, draft: ResumeDraft) -> ResumeDraft:
        self._db.add(draft)
        self._db.commit()
        self._db.refresh(draft)
        return draft

    def get_by_scope(self, session_id: str, draft_id: int) -> Optional[ResumeDraft]:
        return (
            self._db.query(ResumeDraft)
            .filter(ResumeDraft.session_id == session_id, ResumeDraft.id == draft_id)
            .first()
        )

    def list_by_session(self, session_id: str) -> Iterable[ResumeDraft]:
        return (
            self._db.query(ResumeDraft)
            .filter(ResumeDraft.session_id == session_id)
            .order_by(ResumeDraft.created_at.desc())
            .all()
        )

    def update_status(self, session_id: str, draft_id: int, status: str) -> Optional[ResumeDraft]:
        draft = self.get_by_scope(session_id, draft_id)
        if not draft:
            return None
        draft.status = status
        self._db.commit()
        self._db.refresh(draft)
        return draft


class DraftSectionRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, section: ResumeDraftSection) -> ResumeDraftSection:
        self._db.add(section)
        self._db.commit()
        self._db.refresh(section)
        return section

    def create_many(self, sections: list[ResumeDraftSection]) -> list[ResumeDraftSection]:
        self._db.add_all(sections)
        self._db.commit()
        for s in sections:
            self._db.refresh(s)
        return sections

    def list_by_draft(self, draft_id: int) -> list[ResumeDraftSection]:
        return (
            self._db.query(ResumeDraftSection)
            .filter(ResumeDraftSection.draft_id == draft_id)
            .order_by(ResumeDraftSection.order_index)
            .all()
        )

    def get_section(self, draft_id: int, section_id: str) -> Optional[ResumeDraftSection]:
        return (
            self._db.query(ResumeDraftSection)
            .filter(
                ResumeDraftSection.draft_id == draft_id,
                ResumeDraftSection.section_id == section_id,
            )
            .first()
        )

    def update_current_text(self, draft_id: int, section_id: str, text: str) -> Optional[ResumeDraftSection]:
        section = self.get_section(draft_id, section_id)
        if not section:
            return None
        section.current_text = text
        self._db.commit()
        self._db.refresh(section)
        return section

    def update_proposed(
        self, draft_id: int, section_id: str, proposed_text: str,
    ) -> Optional[ResumeDraftSection]:
        section = self.get_section(draft_id, section_id)
        if not section:
            return None
        section.proposed_text = proposed_text
        self._db.commit()
        self._db.refresh(section)
        return section

    def accept_proposed(self, draft_id: int, section_id: str) -> Optional[ResumeDraftSection]:
        section = self.get_section(draft_id, section_id)
        if not section or not section.proposed_text:
            return None
        section.current_text = section.proposed_text
        section.proposed_text = None
        section.last_feedback = "liked"
        self._db.commit()
        self._db.refresh(section)
        return section

    def set_feedback(self, draft_id: int, section_id: str, feedback: str) -> Optional[ResumeDraftSection]:
        section = self.get_section(draft_id, section_id)
        if not section:
            return None
        section.last_feedback = feedback
        self._db.commit()
        self._db.refresh(section)
        return section


class SectionChatRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def add_message(
        self,
        draft_id: int,
        section_id: str,
        role: str,
        content: str,
    ) -> SectionChatMessage:
        # Compute next turn_index
        max_turn = (
            self._db.query(SectionChatMessage.turn_index)
            .filter(
                SectionChatMessage.draft_id == draft_id,
                SectionChatMessage.section_id == section_id,
            )
            .order_by(SectionChatMessage.turn_index.desc())
            .first()
        )
        next_turn = (max_turn[0] + 1) if max_turn else 0
        msg = SectionChatMessage(
            draft_id=draft_id,
            section_id=section_id,
            role=role,
            content=content,
            turn_index=next_turn,
        )
        self._db.add(msg)
        self._db.commit()
        self._db.refresh(msg)
        return msg

    def get_history(
        self, draft_id: int, section_id: str, *, last_n: int | None = None,
    ) -> list[SectionChatMessage]:
        q = (
            self._db.query(SectionChatMessage)
            .filter(
                SectionChatMessage.draft_id == draft_id,
                SectionChatMessage.section_id == section_id,
            )
            .order_by(SectionChatMessage.turn_index)
        )
        messages = q.all()
        if last_n is not None and len(messages) > last_n:
            messages = messages[-last_n:]
        return messages
