"""Prompt builders. Callers never name a model here."""


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
