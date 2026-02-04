"""Prompt builders for pipeline: resume tailoring and cover letter."""


def build_tailor_resume_prompt(job_description: str, resume_text: str) -> str:
    return f"""You are a resume expert. Tailor the following resume to better match the job description.
Output only the tailored resume text, with no extra commentary or labels.

Job description:
---
{job_description}
---

Original resume:
---
{resume_text}
---

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
