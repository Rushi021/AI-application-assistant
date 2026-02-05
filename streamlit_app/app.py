"""
Streamlit test workflow: paste job description, upload resume, generate tailored resume + cover letter.
Tailored resume is applied back to your Word doc (same format/font/spacing); you can download it after approval.
"""

import os

import requests
import streamlit as st

# -----------------------------------------------------------------------------
# Config: backend URL and auth token (env or sidebar)
# -----------------------------------------------------------------------------
def _get_config():
    backend_url = os.environ.get("BACKEND_URL", "").rstrip("/")
    auth_token = os.environ.get("BACKEND_AUTH_TOKEN", "") or os.environ.get("TEST_TOKEN", "")
    return backend_url, auth_token


def _headers():
    _, token = _get_config()
    return {"Authorization": f"Bearer {token}"} if token else {}


# -----------------------------------------------------------------------------
# API helpers
# -----------------------------------------------------------------------------
def upload_resume(backend_url: str, file_bytes: bytes, filename: str) -> dict:
    resp = requests.post(
        f"{backend_url}/resumes/upload",
        files={"file": (filename, file_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        headers=_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def run_pipeline(
    backend_url: str,
    job_description: str,
    resume_id: int,
    tailor_instructions: str | None = None,
    cover_letter_instructions: str | None = None,
) -> dict:
    payload = {
        "job_description": job_description,
        "resume_id": resume_id,
    }
    if tailor_instructions:
        payload["tailor_instructions"] = tailor_instructions
    if cover_letter_instructions:
        payload["cover_letter_instructions"] = cover_letter_instructions
    resp = requests.post(
        f"{backend_url}/pipeline/run",
        json=payload,
        headers={**_headers(), "Content-Type": "application/json"},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def download_tailored_doc(backend_url: str, run_id: int) -> bytes:
    resp = requests.get(
        f"{backend_url}/pipeline/runs/{run_id}/apply-doc",
        headers=_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content


# -----------------------------------------------------------------------------
# UI
# -----------------------------------------------------------------------------
st.set_page_config(page_title="AI Job Application Assistant", layout="wide")
st.title("AI Job Application Assistant")
st.caption("Paste the job description, upload your resume (Word .docx), then generate. Tailored resume keeps your doc format; cover letter follows your structure if you provide it.")

backend_url, auth_token = _get_config()
with st.sidebar:
    st.subheader("Backend")
    backend_url = st.text_input("Backend URL", value=backend_url or "http://localhost:8000", help="e.g. http://localhost:8000")
    auth_token = st.text_input("Auth token", value=auth_token, type="password", help="Use TEST_TOKEN from backend .env")
    if auth_token:
        os.environ["BACKEND_AUTH_TOKEN"] = auth_token
    st.divider()
    st.caption("Ensure the FastAPI backend is running and your .env has GOOGLE_AI_API_KEY set.")

job_description = st.text_area(
    "Job description",
    height=200,
    placeholder="Paste the full job description here...",
    help="The JD is used to tailor your resume and generate the cover letter.",
)
resume_file = st.file_uploader(
    "Upload resume (Word .docx)",
    type=["docx"],
    help="Upload a .docx resume. The tailored content will be applied back into this document without changing format, font, or spacing.",
)
tailor_instructions = st.text_area(
    "Resume tailor instructions (optional)",
    height=80,
    placeholder="e.g. Emphasize Python and AWS; keep experience section concise.",
)
cover_letter_instructions = st.text_area(
    "Cover letter structure / instructions (optional)",
    height=120,
    placeholder="e.g. Use: Opening (1 short para), Why this role (2–3 bullets), Why me (1 para), Closing. Keep under 300 words.",
    help="Guide the LLM so the cover letter follows your preferred structure.",
)

generate = st.button("Generate tailored resume & cover letter", type="primary")

if generate:
    if not job_description or not job_description.strip():
        st.error("Please paste the job description.")
        st.stop()
    if not resume_file:
        st.error("Please upload your resume (Word .docx).")
        st.stop()
    backend_url = backend_url.rstrip("/")
    if not backend_url:
        st.error("Please set Backend URL in the sidebar.")
        st.stop()
    if not auth_token:
        st.error("Please set Auth token in the sidebar (use TEST_TOKEN from backend .env).")
        st.stop()

    with st.spinner("Uploading resume..."):
        file_bytes = resume_file.read()
        try:
            upload_result = upload_resume(backend_url, file_bytes, resume_file.name)
            resume_id = upload_result["id"]
        except requests.RequestException as e:
            st.error(f"Upload failed: {e}")
            if hasattr(e, "response") and e.response is not None:
                st.code(e.response.text[:500] if e.response.text else e.response.reason)
            st.stop()

    with st.spinner("Running pipeline (tailor + cover letter in parallel)..."):
        try:
            run = run_pipeline(
                backend_url,
                job_description.strip(),
                resume_id,
                tailor_instructions=tailor_instructions.strip() or None,
                cover_letter_instructions=cover_letter_instructions.strip() or None,
            )
        except requests.RequestException as e:
            st.error("Pipeline failed")
            if hasattr(e, "response") and e.response is not None:
                try:
                    err = e.response.json()
                    if "detail" in err:
                        st.error(err["detail"])
                    else:
                        st.code(e.response.text[:800] if e.response.text else e.response.reason)
                except Exception:
                    st.code(e.response.text[:800] if e.response.text else e.response.reason)
            else:
                st.code(str(e))
            st.stop()

    if run.get("status") != "completed":
        st.warning(f"Pipeline status: {run.get('status')}. Check backend logs.")
    else:
        st.success("Done. Review the outputs below.")

    run_id = run["id"]
    st.session_state["last_run_id"] = run_id
    st.session_state["last_run"] = run
    st.session_state["backend_url"] = backend_url

# Show results from last run
if "last_run" in st.session_state:
    run = st.session_state["last_run"]
    run_id = st.session_state["last_run_id"]
    backend_url = st.session_state.get("backend_url", "").rstrip("/")

    st.divider()
    st.subheader("Tailored resume")
    if run.get("tailored_resume"):
        st.text_area("Tailored resume text", value=run["tailored_resume"], height=280, disabled=True, label_visibility="collapsed")
        if run.get("resume_id") and run.get("tailored_sections") and backend_url:
            doc_key = f"tailored_doc_{run_id}"
            if doc_key not in st.session_state:
                with st.spinner("Preparing download..."):
                    try:
                        st.session_state[doc_key] = download_tailored_doc(backend_url, run_id)
                    except requests.RequestException as e:
                        st.session_state[doc_key] = None
                        st.error(f"Could not prepare download: {e}")
            if st.session_state.get(doc_key) is not None:
                st.download_button(
                    label="Download tailored resume (Word)",
                    data=st.session_state[doc_key],
                    file_name=f"tailored_resume.docx",
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    key="dl_resume_file",
                )
        else:
            st.caption("Download is available when the run was created with an uploaded Word resume.")
    else:
        st.info("No tailored resume in this run.")

    st.subheader("Cover letter")
    if run.get("cover_letter"):
        st.text_area("Cover letter text", value=run["cover_letter"], height=320, disabled=True, label_visibility="collapsed")
        st.download_button(
            label="Download cover letter (.txt)",
            data=run["cover_letter"],
            file_name="cover_letter.txt",
            mime="text/plain",
            key="dl_cover",
        )
    else:
        st.info("No cover letter in this run.")
