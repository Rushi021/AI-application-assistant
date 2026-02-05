"""Prompt builders for pipeline: resume tailoring and cover letter."""


def build_tailor_resume_prompt(
    job_description: str,
    resume_text: str,
    tailor_instructions: str | None = None,
) -> str:
    extra = ""
    if tailor_instructions:
        extra = f"\nAdditional instructions from the candidate:\n---\n{tailor_instructions}\n---\n\n"
    return f"""You are a resume expert. Tailor the following resume to better match the job description.
{extra}Output only the tailored resume text, with no extra commentary or labels.

Job description:
---
{job_description}
---

Original resume:
---
{resume_text}
---

Tailored resume:"""


def build_tailor_resume_sectioned_prompt(
    job_description: str,
    sectioned_resume_text: str,
    num_sections: int,
    tailor_instructions: str | None = None,
) -> str:
    """Build prompt so the LLM returns one block per section, separated by ---SECTION---."""
    extra = ""
    if tailor_instructions:
        extra = f"\nAdditional instructions from the candidate:\n---\n{tailor_instructions}\n---\n\n"
    return f"""You are a resume expert. Tailor the following resume to better match the job description.
The resume is split into {num_sections} sections. You MUST return exactly {num_sections} sections in the same order.
Between each section, write exactly this delimiter on its own line: ---SECTION---
{extra}Do not add any other commentary. Output only the tailored sections separated by ---SECTION---.

Job description:
---
{job_description}
---

Original resume (sections):
---
{sectioned_resume_text}
---

Tailored resume (output {num_sections} sections, separated by ---SECTION---):"""


def build_cover_letter_prompt(
    job_description: str,
    resume_text: str,
    cover_letter_instructions: str | None = None,
) -> str:
    structure_note = ""
    if cover_letter_instructions:
        structure_note = f"""Follow this structure or guidance for the cover letter:
---
{cover_letter_instructions}
---

"""
    return f"""You are a professional cover letter writer. Write a concise, compelling cover letter for this role based on the job description and the candidate's resume.
{structure_note}Output only the cover letter text, with no extra commentary or labels.

Job description:
---
{job_description}
---

Candidate resume:
---
{resume_text}
---

Cover letter:"""
