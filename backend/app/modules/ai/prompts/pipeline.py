"""Prompt builders. Callers never name a model here."""

from typing import Sequence

# The editable-lines block is fenced with this header so a caller (and the fake
# provider) can find it without guessing.
TAILOR_ITEMS_HEADER = "Resume lines you may rewrite"


def build_tailor_items_prompt(
    job_description: str,
    items: Sequence[dict],
    *,
    frozen_context: str = "",
    instructions: str = "",
) -> str:
    """Ask for line-addressed edits instead of a rewritten document.

    The model only ever sees the lines it is allowed to change, each tagged with an
    id. Everything else is read-only context. That is what lets the renderer put
    each edit back into the exact paragraph it came from, leaving the title,
    section headers, and Education untouched.
    """
    numbered = "\n".join(f'[{item["id"]}] ({item.get("section") or "Resume"}) {item["text"]}' for item in items)
    context = f"\nRead-only context (do not rewrite, do not return ids for these):\n---\n{frozen_context}\n---\n" if frozen_context.strip() else ""
    extra = f"\nPersonalized instructions:\n{instructions}\n" if instructions.strip() else ""
    return f"""You are a resume expert tailoring an existing resume to a job description.

Rules:
- Rewrite only the numbered lines below. Return an entry for each line you changed and omit the ones you leave alone.
- Return the id exactly as given. Never merge, split, reorder, or delete a line.
- Keep each rewritten line at or below the original's character count. The document's layout depends on lines not changing length.
- Stay truthful: never invent an employer, job title, date, degree, or a skill the candidate has not shown.
- Plain text only. No markdown, no bullet glyphs, no leading dashes, no quotes around the line.
- Reproduce any tab characters in the original line exactly, in the same order.

Job description:
---
{job_description}
---
{context}
{TAILOR_ITEMS_HEADER}:
---
{numbered}
---
{extra}"""


def build_tailor_resume_prompt(job_description: str, resume_text: str, instructions: str = "") -> str:
    extra = f"\nPersonalized instructions:\n{instructions}\n" if instructions.strip() else ""
    return f"""You are a resume expert. Tailor the following resume to better match the job description.
Keep the original structure and do not invent employers, dates, or degrees.
Output only the tailored resume text, with no extra commentary or labels.

Job description:
---
{job_description}
---

Original resume:
---
{resume_text}
---
{extra}
Tailored resume:"""


def build_cover_letter_prompt(job_description: str, resume_text: str) -> str:
    return f"""You are a professional cover letter writer. Write a concise, compelling cover letter for this role based on the job description and the candidate's resume.
Output only the cover letter text, with no extra commentary or labels.

Job description:
---
{job_description}
---

Candidate resume:
---
{resume_text}
---

Cover letter:"""


def build_extraction_prompt(job_description: str) -> str:
    return f"""Extract hiring requirements from this job description.
Split them into must_have (required / minimum qualifications) and nice_to_have (preferred / plus).
Each requirement should be a short phrase a keyword matcher can score (a skill, tool, degree, years of experience, or domain).
Do not score the candidate. Do not add requirements that are not in the text.

Job description:
---
{job_description}
---"""


def build_bullet_rewrite_prompt(job_description: str, section_name: str, bullet: str, instructions: str = "") -> str:
    extra = f"\nExtra instructions: {instructions}\n" if instructions.strip() else ""
    return f"""Rewrite this resume bullet so it better matches the job description.
Keep it one bullet, truthful, and specific. Output only the rewritten bullet text.

Section: {section_name}

Job description:
---
{job_description}
---

Original bullet:
---
{bullet}
---
{extra}"""


def build_section_rewrite_prompt(job_description: str, section_name: str, section_text: str, instructions: str = "") -> str:
    extra = f"\nExtra instructions: {instructions}\n" if instructions.strip() else ""
    return f"""Rewrite this resume section so it better matches the job description.
Keep facts truthful. Output only the rewritten section text.

Section: {section_name}

Job description:
---
{job_description}
---

Original section:
---
{section_text}
---
{extra}"""
