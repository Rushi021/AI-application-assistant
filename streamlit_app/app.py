"""
Streamlit test workflow: paste JD, upload resume, score, generate tailored resume + cover letter.
Uses X-Session-Id header for session-based isolation (no login required).
"""

import os
import uuid

import requests
import streamlit as st

# ---------------------------------------------------------------------------
# Page config (must be first Streamlit call)
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="AI Job Application Assistant",
    page_icon="📄",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Custom CSS for cleaner UI
# ---------------------------------------------------------------------------
st.markdown("""
<style>
    /* Tighter section spacing */
    .block-container { padding-top: 2rem; }
    /* Step headers */
    h2 { margin-top: 1.5rem !important; margin-bottom: 0.5rem !important; }
    /* Nicer expanders */
    .streamlit-expanderHeader { font-size: 1rem; font-weight: 600; }
    /* Score metric */
    [data-testid="stMetricValue"] { font-size: 1.5rem; }
    /* Status badges */
    .status-badge {
        display: inline-block; padding: 2px 10px; border-radius: 12px;
        font-size: 0.8rem; font-weight: 600; color: white;
    }
    .status-ok { background: #28a745; }
    .status-warn { background: #ffc107; color: #333; }
    .status-err { background: #dc3545; }
    /* Sidebar */
    section[data-testid="stSidebar"] > div { padding-top: 1rem; }
</style>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------
if "session_id" not in st.session_state:
    st.session_state["session_id"] = str(uuid.uuid4())


def _headers():
    return {"X-Session-Id": st.session_state["session_id"]}


def _api_error(e: requests.RequestException) -> str:
    """Extract a human-readable error from a RequestException."""
    try:
        detail = e.response.json().get("detail", str(e))
    except Exception:
        detail = str(e)
    return detail


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------
def upload_resume(backend_url: str, file_bytes: bytes, filename: str) -> dict:
    resp = requests.post(
        f"{backend_url}/resumes/upload",
        files={"file": (filename, file_bytes,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        headers=_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def list_resumes(backend_url: str) -> list:
    resp = requests.get(f"{backend_url}/resumes", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def score_resumes(backend_url: str, job_description: str, resume_ids: list[int] | None = None) -> dict:
    payload = {"job_description": job_description}
    if resume_ids:
        payload["resume_ids"] = resume_ids
    resp = requests.post(
        f"{backend_url}/resumes/score",
        json=payload,
        headers={**_headers(), "Content-Type": "application/json"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def run_pipeline(backend_url: str, job_description: str, resume_id: int, **kwargs) -> dict:
    payload = {"job_description": job_description, "resume_id": resume_id, **kwargs}
    resp = requests.post(
        f"{backend_url}/pipeline/run",
        json=payload,
        headers={**_headers(), "Content-Type": "application/json"},
        timeout=180,
    )
    resp.raise_for_status()
    return resp.json()


def create_draft(backend_url: str, base_resume_id: int, run_id: int | None = None,
                 starting_source: str = "base", job_description: str | None = None) -> dict:
    payload = {
        "base_resume_id": base_resume_id,
        "starting_source": starting_source,
    }
    if run_id:
        payload["run_id"] = run_id
    if job_description:
        payload["job_description"] = job_description
    resp = requests.post(
        f"{backend_url}/drafts",
        json=payload,
        headers={**_headers(), "Content-Type": "application/json"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def get_draft(backend_url: str, draft_id: int) -> dict:
    resp = requests.get(f"{backend_url}/drafts/{draft_id}", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def chat_section(backend_url: str, draft_id: int, section_id: str,
                 message: str, feedback: str | None = None,
                 include_history: bool = True) -> dict:
    payload = {"message": message, "include_history": include_history}
    if feedback:
        payload["user_feedback"] = feedback
    resp = requests.post(
        f"{backend_url}/drafts/{draft_id}/sections/{section_id}/chat",
        json=payload,
        headers={**_headers(), "Content-Type": "application/json"},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def patch_section(backend_url: str, draft_id: int, section_id: str, text: str) -> dict:
    resp = requests.patch(
        f"{backend_url}/drafts/{draft_id}/sections/{section_id}",
        json={"current_text": text},
        headers={**_headers(), "Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def apply_section(backend_url: str, draft_id: int, section_id: str) -> dict:
    resp = requests.post(
        f"{backend_url}/drafts/{draft_id}/sections/{section_id}/apply",
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def apply_all(backend_url: str, draft_id: int) -> bytes:
    resp = requests.post(
        f"{backend_url}/drafts/{draft_id}/apply-all",
        headers=_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content


def download_tailored_doc(backend_url: str, run_id: int) -> bytes:
    resp = requests.get(
        f"{backend_url}/pipeline/runs/{run_id}/apply-doc",
        headers=_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
with st.sidebar:
    st.markdown("### Settings")
    backend_url = st.text_input(
        "Backend URL",
        value=os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/"),
    )

    st.divider()

    # Connection check
    try:
        r = requests.get(f"{backend_url}/health", timeout=5)
        if r.status_code == 200:
            st.markdown('<span class="status-badge status-ok">Backend connected</span>',
                        unsafe_allow_html=True)
        else:
            st.markdown('<span class="status-badge status-err">Backend error</span>',
                        unsafe_allow_html=True)
    except Exception:
        st.markdown('<span class="status-badge status-err">Backend offline</span>',
                    unsafe_allow_html=True)

    st.caption(f"Session: `{st.session_state['session_id'][:8]}...`")
    st.caption("No login required (session-based).")

    st.divider()

    # Show uploaded resumes in sidebar
    st.markdown("#### My Resumes")
    try:
        resumes = list_resumes(backend_url)
        if resumes:
            for res in resumes:
                st.markdown(f"- **{res['original_filename']}** (ID: {res['id']})")
        else:
            st.caption("No resumes uploaded yet.")
    except Exception:
        st.caption("Could not fetch resumes.")

# ---------------------------------------------------------------------------
# Main content
# ---------------------------------------------------------------------------
st.title("AI Job Application Assistant")
st.caption("Paste a job description, upload your resume, score alignment, and generate a tailored resume + cover letter.")

# ── Step 1: Job Description ────────────────────────────────────────────────
st.markdown("---")
st.header("Step 1: Job Description")
job_description = st.text_area(
    "Paste the full job description below",
    height=200,
    placeholder="Copy and paste the entire job description here...",
)

# ── Step 2: Resume Upload ──────────────────────────────────────────────────
st.markdown("---")
st.header("Step 2: Upload Resume")

col_upload, col_info = st.columns([2, 1])
with col_upload:
    resume_file = st.file_uploader(
        "Choose a .docx file",
        type=["docx"],
        help="Upload your Word resume. Max 2 resumes per session.",
    )
with col_info:
    st.info("Only `.docx` files are supported. Your original formatting will be preserved when changes are applied.")

if resume_file:
    if st.button("Upload Resume", type="primary"):
        with st.spinner("Uploading..."):
            try:
                result = upload_resume(backend_url, resume_file.read(), resume_file.name)
                st.success(f"Uploaded **{result['original_filename']}** (ID: {result['id']})")
                st.rerun()
            except requests.RequestException as e:
                st.error(f"Upload failed: {_api_error(e)}")

# ── Step 3: Score Resumes ──────────────────────────────────────────────────
st.markdown("---")
st.header("Step 3: Score Resume Alignment")
st.caption("See how well your resume matches the job description based on keyword overlap.")

if st.button("Score My Resumes", disabled=not job_description):
    if not job_description:
        st.warning("Paste a job description first.")
    else:
        with st.spinner("Scoring..."):
            try:
                scores = score_resumes(backend_url, job_description)
                st.session_state["scores"] = scores
            except requests.RequestException as e:
                st.error(f"Scoring failed: {_api_error(e)}")

if "scores" in st.session_state:
    for item in st.session_state["scores"]["scores"]:
        with st.container():
            c1, c2, c3 = st.columns([2, 1, 3])
            c1.markdown(f"**{item['original_filename']}**")
            c2.metric("Score", f"{item['score']}/100")
            c3.caption(item['rationale'])
            if item.get("matched_keywords"):
                st.caption(f"Matched: {', '.join(item['matched_keywords'][:10])}")
            if item.get("missing_keywords"):
                st.caption(f"Missing: {', '.join(item['missing_keywords'][:8])}")

# ── Step 4: Generate ───────────────────────────────────────────────────────
st.markdown("---")
st.header("Step 4: Generate")

with st.expander("Optional instructions", expanded=False):
    tailor_instructions = st.text_area(
        "Tailor instructions",
        height=60,
        placeholder="e.g., Emphasize cloud experience, downplay front-end work...",
    )
    cover_letter_instructions = st.text_area(
        "Cover letter instructions",
        height=80,
        placeholder="e.g., Mention my passion for fintech, keep it under 300 words...",
    )

col_a, col_b = st.columns(2)
use_as_is = col_a.button("Use as-is (manual refine only)", use_container_width=True)
tailor = col_b.button("Tailor Resume + Cover Letter", type="primary", use_container_width=True)

if use_as_is or tailor:
    if not job_description:
        st.error("Paste a job description first.")
        st.stop()
    try:
        resumes = list_resumes(backend_url)
    except requests.RequestException:
        resumes = []
    if not resumes:
        st.error("Upload a resume first.")
        st.stop()
    resume_id = resumes[0]["id"]

    if tailor:
        with st.spinner("Running pipeline (tailoring resume + writing cover letter)... This may take 15-30 seconds."):
            try:
                run = run_pipeline(
                    backend_url, job_description, resume_id,
                    tailor_instructions=tailor_instructions or None,
                    cover_letter_instructions=cover_letter_instructions or None,
                )
                st.session_state["last_run"] = run
                st.success("Pipeline complete!")
            except requests.RequestException as e:
                st.error(f"Pipeline failed: {_api_error(e)}")
                st.stop()

        with st.spinner("Creating draft from tailored output..."):
            try:
                draft = create_draft(
                    backend_url, resume_id,
                    run_id=run["id"], starting_source="tailored",
                    job_description=job_description,
                )
                st.session_state["draft"] = draft
            except requests.RequestException as e:
                st.error(f"Draft creation failed: {_api_error(e)}")
                st.stop()
    else:
        with st.spinner("Creating draft from base resume..."):
            try:
                draft = create_draft(
                    backend_url, resume_id,
                    starting_source="base",
                    job_description=job_description,
                )
                st.session_state["draft"] = draft
            except requests.RequestException as e:
                st.error(f"Draft creation failed: {_api_error(e)}")
                st.stop()

# ── Step 5: Manual Refine ──────────────────────────────────────────────────
if "draft" in st.session_state:
    draft = st.session_state["draft"]
    st.markdown("---")
    st.header("Step 5: Manual Refine")
    st.caption(
        f"Draft **#{draft['id']}** | Status: `{draft['status']}` | "
        f"Source: `{draft['starting_source']}`"
    )
    st.markdown(
        "Edit each section below. You can **manually edit** the text area directly, "
        "or use the **chat** to ask the LLM for refinements."
    )

    sections = draft.get("sections", [])
    if not sections:
        st.warning("No sections found in this draft.")
    else:
        for i, section in enumerate(sections):
            sid = section["section_id"]
            is_editable = section.get("editable", True)
            title_label = section["section_title"]

            if not is_editable:
                # ── Non-editable section (e.g. Header / Name + Contact) ──
                with st.expander(f"[Static] {title_label}", expanded=False):
                    st.text_area(
                        "This section is not editable",
                        value=section["current_text"],
                        height=80,
                        disabled=True,
                        key=f"static_{draft['id']}_{sid}",
                        label_visibility="collapsed",
                    )
                    st.caption("Header info (name, contact) is kept as-is.")
            else:
                # ── Editable section ──
                with st.expander(
                    f"{title_label}",
                    expanded=(i <= 1),  # expand first editable section
                ):
                    # Editable text
                    edit_key = f"edit_{draft['id']}_{sid}"
                    edited = st.text_area(
                        "Current text (editable)",
                        value=section["current_text"],
                        height=180,
                        key=edit_key,
                        label_visibility="collapsed",
                    )

                    # Proposed text (if LLM has suggested something)
                    if section.get("proposed_text"):
                        st.markdown("**LLM Proposed Revision:**")
                        st.info(section["proposed_text"])

                    # Action row
                    st.markdown("##### Refine with AI")
                    chat_key = f"chat_{draft['id']}_{sid}"
                    chat_msg = st.text_input(
                        "Ask the LLM to refine this section",
                        key=chat_key,
                        placeholder="e.g., Make the bullet points more quantitative...",
                        label_visibility="collapsed",
                    )
                    history_key = f"history_{draft['id']}_{sid}"
                    use_history = st.checkbox(
                        "Use conversation history",
                        value=True,
                        key=history_key,
                    )

                    btn_cols = st.columns([1, 1, 1, 2])
                    with btn_cols[0]:
                        send = st.button("Send to AI", key=f"send_{sid}", use_container_width=True)
                    with btn_cols[1]:
                        accept = st.button("Accept proposed", key=f"accept_{sid}", use_container_width=True)
                    with btn_cols[2]:
                        save_edit = st.button("Save manual edit", key=f"save_{sid}", use_container_width=True)

                    if send:
                        if chat_msg:
                            with st.spinner("LLM refining..."):
                                try:
                                    resp = chat_section(
                                        backend_url,
                                        draft["id"],
                                        sid,
                                        chat_msg,
                                        include_history=use_history,
                                    )
                                    st.success("Proposed revision ready.")
                                    section["proposed_text"] = resp["proposed_text"]
                                    st.rerun()
                                except requests.RequestException as e:
                                    st.error(f"Chat failed: {_api_error(e)}")
                        else:
                            st.warning("Type a message first.")

                    if accept:
                        if section.get("proposed_text"):
                            try:
                                apply_section(backend_url, draft["id"], sid)
                                st.success("Section accepted and applied.")
                                # Refresh draft
                                st.session_state["draft"] = get_draft(backend_url, draft["id"])
                                st.rerun()
                            except requests.RequestException as e:
                                st.error(f"Accept failed: {_api_error(e)}")
                        else:
                            st.warning("No proposed text to accept. Send a chat first.")

                    if save_edit:
                        try:
                            patch_section(backend_url, draft["id"], sid, edited)
                            st.success("Manual edit saved.")
                        except requests.RequestException as e:
                            st.error(f"Save failed: {_api_error(e)}")

        # Final apply
        st.markdown("---")
        if st.button("Apply All Changes & Download Final Resume", type="primary",
                      use_container_width=True):
            with st.spinner("Generating final document..."):
                try:
                    doc_bytes = apply_all(backend_url, draft["id"])
                    st.download_button(
                        "Download Final Resume (.docx)",
                        data=doc_bytes,
                        file_name="final_resume.docx",
                        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        use_container_width=True,
                    )
                    st.success("Document saved locally and ready for download.")
                except requests.RequestException as e:
                    st.error(f"Apply failed: {_api_error(e)}")

# ── Cover Letter ───────────────────────────────────────────────────────────
if "last_run" in st.session_state:
    run = st.session_state["last_run"]
    if run.get("cover_letter"):
        st.markdown("---")
        st.header("Cover Letter")
        st.text_area(
            "Generated Cover Letter",
            value=run["cover_letter"],
            height=300,
            disabled=True,
            label_visibility="collapsed",
        )
        st.download_button(
            "Download Cover Letter (.txt)",
            data=run["cover_letter"],
            file_name="cover_letter.txt",
            mime="text/plain",
            use_container_width=True,
        )
        st.caption("Cover letter has also been auto-saved to your local output folder.")
