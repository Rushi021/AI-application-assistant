"""Prompt builders for pipeline: resume tailoring and cover letter."""

from __future__ import annotations

from typing import Any, Dict, List


def build_tailor_resume_prompt(
    job_description: str,
    resume_text: str,
    tailor_instructions: str | None = None,
) -> str:
    """Fallback prompt when no parsed JSON sections are available."""
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


def build_tailor_resume_json_prompt(
    job_description: str,
    editable_sections: List[Dict[str, Any]],
    tailor_instructions: str | None = None,
) -> str:
    """
    Build a tailor prompt that sends editable sections by ID and instructs the
    LLM to return a JSON array of {id, text} objects.
    """
    extra = ""
    if tailor_instructions:
        extra = f"\nAdditional instructions from the candidate:\n---\n{tailor_instructions}\n---\n"

    # Build section blocks for the prompt
    section_blocks: list[str] = []
    section_ids: list[str] = []
    for sec in editable_sections:
        sid = sec["id"]
        title = sec["title"]
        content = sec["content"]
        section_ids.append(sid)
        section_blocks.append(f'[id={sid}] {title}\n{content}')

    sections_text = "\n\n".join(section_blocks)
    num = len(editable_sections)
    ids_list = ", ".join(f'"{sid}"' for sid in section_ids)

    return f"""You are a resume expert. Tailor the following resume sections to better match the job description.

RULES:
- You MUST return a valid JSON array with exactly {num} objects.
- Each object MUST have exactly two keys: "id" (string) and "text" (string).
- The "id" values MUST be exactly: {ids_list}
- The "text" value is the tailored content for that section.
- Preserve the line structure within each section (bullet points stay as separate lines).
- Do NOT add any commentary, markdown, or text outside the JSON array.
- Do NOT wrap the JSON in code fences or backticks.
{extra}
Job description:
---
{job_description}
---

Resume sections to tailor:
---
{sections_text}
---

Output (JSON array only):"""


def build_cover_letter_prompt(
    job_description: str,
    resume_text: str,
    cover_letter_instructions: str | None = None,
) -> str:
    extra = ""
    if cover_letter_instructions:
        extra = f"""The candidate has also provided additional guidance:
---
{cover_letter_instructions}
---

"""
    return f"""You are a professional cover letter writer. Using the candidate's resume and the job description provided below, create a cover letter that best aligns with the job requirements.

IMPORTANT RULES:
- Include a mix of both technical and soft skills from the resume.
- Do NOT invent anything outside the information provided. Do NOT fabricate work, projects, or experiences that are not in the resume.
- Output ONLY the cover letter text. No extra commentary, labels, or explanation.

The cover letter MUST strictly follow this 3-paragraph structure:

PARAGRAPH 1 — "Why?" (The Hook):
This paragraph answers "Why are you applying?" Hook the reader in. Explain what about the company or role appeals to the candidate. Tell a brief story or give the company a genuine compliment. Express excitement for the position and make the reader want to continue reading.

PARAGRAPH 2 — "What can you do for me?" (Skills & Experience):
This paragraph relates the candidate's experience directly to the requirements of the job. Pick two or three key requirements from the job description that the candidate fulfills, and for each one, explain how the candidate's specific experience satisfies that requirement. Always tie the requirement back to concrete experience from the resume. For example: "In one of my projects I used SQL and programming languages to perform data analysis using statistical measures and predictive modeling, which meets your requirement of needing someone who knows SQL and programming languages."

PARAGRAPH 3 — "Call to Action":
This paragraph wraps up with enthusiasm and a call to action. Use a structure similar to: "An opportunity at [Company] presents a unique chance to demonstrate my ability in [relevant area]. Working at an innovative and forward-thinking company like [Company] offers both the professional experience and the chance to further develop my skills in [relevant field]. I look forward to further discussing opportunities within your company so please contact me so that we can discuss this exciting opportunity in more detail."

Here is an example of an excellent cover letter following this format (use it as a style reference, NOT as content to copy):
---
Dear Hiring Manager,

I am applying to the Tech Connect Program at J.P. Morgan that I found on the company's career site. I'm drawn to the program's emphasis on bringing individuals from diverse backgrounds together to develop innovative technology solutions. As someone with strong internship experience in the financial services industry, and classroom learning in technology, I will be able to make a strong contribution to the Tech Connect Program. Furthermore, my ability to learn quickly, and question the "why" behind every solution will help me contribute greatly to your program.

Through my classwork in Financial Analytics, I gained exposure to data analysis using R, and I continued to hone my skills in a class called Data Visualization. Not only does this meet your requirement of exposure to data analysis, but it also demonstrates my familiarity with programming languages. In my internship with Crowe LLP, I was assigned a weekly research topic within the financial services industry and reported my findings back to my supervisors as a formal presentation. Given the virtual nature of my internship, it was critical for me to be in constant communication with my team about my progress and concerns. This experience meets your requirement of excellent communication skills. Finally, in my role as a Resident Advisor, I frequently resolve the problems and concerns of my residents by using the limited information available to draw conclusions about the scope of the situation. The thought process required to diagnose the situation and the skills required to solve it meet your requirement of exceptional analytical and problem-solving skills.

This program would allow me to bring my business acumen and technical skills to an organization whose mission to foster intellectual curiosity and develop innovative technology solutions closely aligns with my own. Please contact me so that we can discuss this exciting opportunity in more detail.
---

{extra}Job description:
---
{job_description}
---

Candidate resume:
---
{resume_text}
---

Cover letter:"""
