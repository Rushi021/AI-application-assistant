# Implementation Notes

Short reference: **what** we implemented, **why**, and **where**. Use this so you’re not working blindly.

---

## Pipeline: Tailor + Cover Letter (parallel LLM)

**What**  
Run pipeline with a **hardcoded job description** and resume text; two **parallel** LLM calls: (1) tailor resume, (2) write cover letter. Response returns both.

**Why**  
Modular workflow before adding DOM/screen capture. Job description is provided by the client (e.g. hardcoded); later you can swap to dynamic retrieval.

**Where**

| Area | File(s) | Purpose |
|------|--------|--------|
| Request/response | `backend/app/modules/pipeline/schemas.py` | `PipelineRunCreate`: `job_description`, `resume_text` or `resume_id`, optional `tailor_instructions`. `PipelineRunRead`: adds `tailored_resume`, `cover_letter`, `tailored_sections`, `resume_id`. |
| DB model | `backend/app/modules/pipeline/models.py` | `PipelineRun`: `job_description`, `resume_text`, `resume_id`, `tailored_resume`, `tailored_sections`, `cover_letter`, `status`. |
| Repo | `backend/app/common/ports.py` | `PipelineRunRepo.update_results(..., tailored_sections=...)` contract. `ResumeStorage.get_file_bytes(file_key)` for docx. |
| Repo impl | `backend/app/common/adapters/sqlalchemy_repos.py` | `SqlAlchemyPipelineRunRepo.update_results` writes results and status. |
| Docx | `backend/app/common/docx_service.py` | `parse_docx`, `apply_tailored_sections`, `build_sectioned_resume_text`, `parse_sectioned_tailored_output` — parse Word, apply edits preserving format. |
| Prompts | `backend/app/modules/ai/prompts/pipeline.py` | `build_tailor_resume_prompt`, `build_tailor_resume_sectioned_prompt`, `build_cover_letter_prompt`. |
| Orchestrator | `backend/app/modules/ai/orchestrator.py` | `run_tailor_and_cover_letter(..., sectioned_resume_text, num_paragraphs, tailor_instructions)` — parallel tailor + cover letter; returns `tailored_sections` when sectioned. |
| Pipeline API | `backend/app/modules/pipeline/router.py` | `POST /pipeline/run`: resolve resume (text or docx), create run → orchestrator → `update_results`. `GET /pipeline/runs/{id}/apply-doc`: return tailored .docx. |

**Workflow (main use)**  
1. Client sends `POST /pipeline/run` with `job_description` and either `resume_text` or `resume_id` (uploaded Word doc). Optional: `tailor_instructions`.  
2. If `resume_id`: backend loads the docx from storage, parses it (preserving paragraph order), and uses a **sectioned** tailor prompt so the LLM returns one block per paragraph separated by `---SECTION---`. This allows applying edits back to the Word doc without breaking format.  
3. Backend creates a run (`status=running`), calls the orchestrator (tailor + cover letter in parallel).  
4. Backend updates the run with `tailored_resume`, `cover_letter`, and when from docx: `tailored_sections` (JSON list).  
5. Response is the run including `tailored_resume` and `cover_letter`.  
6. **Apply to Word**: After user approval, client calls `GET /pipeline/runs/{run_id}/apply-doc` to download the modified .docx with tailored content in place; font, spacing, and layout are preserved (see `app/common/docx_service.py`).

---

## LLM: Port + Gemini Provider

**What**  
Abstract LLM port and one adapter: Gemini (Google AI Studio API key). Config uses real variable names; credentials are env-driven (placeholder in `.env.example`).

**Why**  
So you can change provider (e.g. another model/API) later by swapping the adapter; config stays in one place.

**Where**

| Area | File(s) | Purpose |
|------|--------|--------|
| Port | `backend/app/common/ports.py` | `LLMProvider`: `generate(prompt, **kwargs) -> str`. |
| Config | `backend/app/core/config.py` | `google_ai_api_key`, `gemini_model` (read from env). |
| Provider | `backend/app/modules/ai/providers/gemini_provider.py` | `GeminiProvider` implements `LLMProvider` using `google.generativeai`. |
| Deps | `backend/app/core/deps.py` | `get_llm_provider()` returns `GeminiProvider()` (injectable). |
| Env | `backend/.env.example` | `GOOGLE_AI_API_KEY`, `GEMINI_MODEL`. |
| Deps | `backend/requirements.txt` | `google-generativeai>=0.8.0`. |

---

## Quick “where is X?” map

- **Change tailor/cover letter prompts** → `backend/app/modules/ai/prompts/pipeline.py`
- **Change LLM provider** → implement `LLMProvider` in `backend/app/modules/ai/providers/` and wire in `get_llm_provider()` (e.g. in `deps.py`)
- **Change pipeline inputs/outputs** → `pipeline/schemas.py`, `pipeline/models.py`, `pipeline/router.py`
- **Add another parallel LLM step** → extend `orchestrator.py` and pipeline model/repo/schemas

---

## Where is data stored?

| Data | Where |
|------|--------|
| **Cover letter & tailored resume text** | **Database**: table `pipeline_runs`. Columns `cover_letter`, `tailored_resume`, `tailored_sections` (JSON), plus `job_description`, `resume_text`, `resume_id`, `status`. One row per pipeline run. |
| **Uploaded resume file (Word .docx)** | **File storage**: path from `LOCAL_STORAGE_PATH` (e.g. `./data/resumes` in backend). Filename is a UUID + `.docx`. The **database** table `resumes` stores `file_key`, `original_filename`, `user_id`, etc., and points to that file. |
| **Tailored Word doc** | Not stored as a file. It is **generated on demand** when you call `GET /pipeline/runs/{run_id}/apply-doc`: the backend reads the original docx from storage, applies `tailored_sections` in memory, and returns the bytes. You download it from the Streamlit app. |
