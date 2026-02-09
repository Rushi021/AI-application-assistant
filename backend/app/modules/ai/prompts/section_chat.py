"""Prompt builder for the per-section chat refinement loop."""

from __future__ import annotations

from typing import List

from app.modules.drafts.models import SectionChatMessage

MAX_HISTORY_TURNS = 10  # Keep prompt concise


def build_section_chat_prompt(
    section_title: str,
    current_text: str,
    job_description: str | None,
    user_message: str,
    user_feedback: str | None,
    history: List[SectionChatMessage],
) -> str:
    """
    Build a prompt for the LLM to refine one resume section based on
    the chat history, user feedback, and new instruction.
    """
    parts: list[str] = []

    parts.append(
        "You are a resume expert helping refine a single section of a resume. "
        "Return ONLY the revised section text. No commentary, labels, or explanation.\n"
    )

    if job_description:
        parts.append(f"Job description:\n---\n{job_description}\n---\n")

    parts.append(f"Section: {section_title}\n")
    parts.append(f"Current text:\n---\n{current_text}\n---\n")

    # Conversation history (bounded)
    recent = history[-MAX_HISTORY_TURNS:] if len(history) > MAX_HISTORY_TURNS else history
    if recent:
        parts.append("Conversation so far:")
        for msg in recent:
            label = "User" if msg.role == "user" else "Assistant"
            parts.append(f"  {label}: {msg.content}")
        parts.append("")

    if user_feedback == "disliked":
        parts.append(
            "The user did NOT like the last proposed revision. "
            "The user is now providing corrections or different instructions.\n"
        )

    parts.append(f"User instruction: {user_message}\n")
    parts.append("Revised section text:")

    return "\n".join(parts)
