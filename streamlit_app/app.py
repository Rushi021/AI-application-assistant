"""
Streamlit user app: dashboard UI aligned with the extension onboarding profile,
wired to the same FastAPI backend as the Chrome extension.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from html import escape
from typing import Any
from urllib.parse import quote_plus, urlparse

import requests
import streamlit as st


# Must match backend `MAX_RESUMES_PER_SESSION` and extension `MAX_RESUMES_PER_SESSION`.
MAX_RESUMES = 7

APPLICATION_STATUSES = [
    "applied",
    "assessment",
    "interview_round_1",
    "interview_round_2",
    "interview_round_3",
    "offer",
    "rejected",
    "withdrawn",
]

SALARY_CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD"]

# EEO (aligned with reference EEOSection; stored in profile + custom_fields)
EEO_RACE_OPTIONS = [
    "American Indian or Alaska Native",
    "Asian",
    "Black or African American",
    "Native Hawaiian or Pacific Islander",
    "White",
    "Two or more races",
    "Prefer not to say",
]
EEO_ORIENTATION_OPTIONS = [
    "Heterosexual",
    "Gay",
    "Lesbian",
    "Bisexual",
    "Queer",
    "Pansexual",
    "Asexual",
    "Other",
    "Prefer not to say",
]

GENDER_OPTS = ["", "male", "female", "non-binary", "transgender", "other"]
GENDER_LABEL = {
    "": "Prefer not to say",
    "male": "Male",
    "female": "Female",
    "non-binary": "Non-binary",
    "transgender": "Transgender",
    "other": "Other",
}

st.set_page_config(
    page_title="AI Job Assistant",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ── session ───────────────────────────────────────────────────────────────────


def init_state() -> None:
    st.session_state.setdefault("access_token", None)
    st.session_state.setdefault("refresh_token", None)
    st.session_state.setdefault("profile", None)
    st.session_state.setdefault("main_nav", "dashboard")
    st.session_state.setdefault("dash_tab", "profile")
    st.session_state.setdefault("selected_application_id", None)
    st.session_state.setdefault("pipeline_days", 1)
    st.session_state.setdefault("apps_search", "")
    st.session_state.setdefault("apps_filter", "all")
    st.session_state.setdefault("resume_uploader_nonce", 0)
    st.session_state.setdefault("resume_last_upload_token", None)
    st.session_state.setdefault("backend_url", os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/"))
    st.session_state.setdefault("app_url", os.environ.get("STREAMLIT_APP_URL", "http://localhost:8501").rstrip("/"))


def clear_auth_state() -> None:
    st.session_state["access_token"] = None
    st.session_state["refresh_token"] = None
    st.session_state["profile"] = None
    st.session_state.pop("session_id", None)
    st.session_state.pop("resume_uploader_nonce", None)
    st.session_state.pop("resume_last_upload_token", None)
    st.session_state.pop("selected_application_id", None)
    st.session_state.pop("pipeline_days", None)
    for k in list(st.session_state.keys()):
        if (
            k.startswith("pf_")
            or k.startswith("app_srv_")
            or k.startswith("app_status_err_")
            or k in ("work_count", "edu_count", "_hydrated_profile_id")
        ):
            del st.session_state[k]
    st.query_params.clear()


# ── HTTP ──────────────────────────────────────────────────────────────────────


def auth_headers_json() -> dict[str, str]:
    """Include X-Session-Id for routes that use get_request_scope (/resumes, pipeline, etc.)."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    sid = st.session_state.get("session_id")
    if sid:
        headers["X-Session-Id"] = sid
    if st.session_state.get("access_token"):
        headers["Authorization"] = f"Bearer {st.session_state['access_token']}"
    return headers


def auth_headers_bare() -> dict[str, str]:
    headers: dict[str, str] = {}
    sid = st.session_state.get("session_id")
    if sid:
        headers["X-Session-Id"] = sid
    if st.session_state.get("access_token"):
        headers["Authorization"] = f"Bearer {st.session_state['access_token']}"
    return headers


def ensure_session_id() -> None:
    """Backend requires a UUID in X-Session-Id for session-scoped APIs (e.g. GET /resumes)."""
    if st.session_state.get("access_token") and not st.session_state.get("session_id"):
        st.session_state["session_id"] = str(uuid.uuid4())


def refresh_access_token(backend_url: str) -> bool:
    refresh = requests.post(
        f"{backend_url}/auth/refresh",
        headers={"Content-Type": "application/json"},
        json={"refresh_token": st.session_state["refresh_token"]},
        timeout=30,
    )
    if not refresh.ok:
        return False
    new_access = refresh.json().get("access_token")
    if not new_access:
        return False
    st.session_state["access_token"] = new_access
    return True


def api_request(
    backend_url: str,
    path: str,
    *,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    auth_required: bool = True,
) -> requests.Response:
    response = requests.request(
        method=method,
        url=f"{backend_url}{path}",
        headers=auth_headers_json(),
        json=json_body,
        timeout=120,
    )
    if auth_required and response.status_code == 401 and st.session_state.get("refresh_token"):
        if refresh_access_token(backend_url):
            response = requests.request(
                method=method,
                url=f"{backend_url}{path}",
                headers=auth_headers_json(),
                json=json_body,
                timeout=120,
            )
    return response


def api_upload_resume(backend_url: str, file_bytes: bytes, filename: str) -> requests.Response:
    files = {"file": (filename, file_bytes)}
    response = requests.post(
        f"{backend_url}/resumes/upload",
        headers=auth_headers_bare(),
        files=files,
        timeout=120,
    )
    if response.status_code == 401 and st.session_state.get("refresh_token"):
        if refresh_access_token(backend_url):
            response = requests.post(
                f"{backend_url}/resumes/upload",
                headers=auth_headers_bare(),
                files=files,
                timeout=120,
            )
    return response


def api_delete_resume(backend_url: str, resume_id: int) -> requests.Response:
    response = requests.delete(
        f"{backend_url}/resumes/{resume_id}",
        headers=auth_headers_bare(),
        params={"force": "true"},
        timeout=60,
    )
    if response.status_code == 401 and st.session_state.get("refresh_token"):
        if refresh_access_token(backend_url):
            response = requests.delete(
                f"{backend_url}/resumes/{resume_id}",
                headers=auth_headers_bare(),
                params={"force": "true"},
                timeout=60,
            )
    return response


def exchange_web_login_code(backend_url: str, code: str) -> bool:
    response = requests.post(
        f"{backend_url}/auth/web/exchange",
        headers={"Content-Type": "application/json"},
        json={"code": code},
        timeout=30,
    )
    if not response.ok:
        st.error(f"Login exchange failed: {response.text}")
        return False

    payload = response.json()
    st.session_state["access_token"] = payload.get("access_token")
    st.session_state["refresh_token"] = payload.get("refresh_token")
    st.session_state["session_id"] = str(uuid.uuid4())
    st.query_params.clear()
    return True


def fetch_profile(backend_url: str) -> dict[str, Any] | None:
    response = api_request(backend_url, "/users/me/profile")
    if response.ok:
        return response.json()
    if response.status_code in (401, 403):
        clear_auth_state()
        return None
    st.error(f"Failed to load profile: {response.text}")
    return None


# ── profile parsing (parity with extension ProfileSetupPage) ─────────────────


def _empty_edu_row() -> dict[str, Any]:
    return {
        "university": "",
        "degree": "",
        "field_of_study": "",
        "graduation_year": None,
        "gpa": None,
    }


def _empty_work_row() -> dict[str, Any]:
    return {
        "job_title": "",
        "company": "",
        "location": "",
        "start_month": "",
        "start_year": "",
        "end_month": "",
        "end_year": "",
        "description": "",
    }


def parse_education_rows(p: dict[str, Any]) -> list[dict[str, Any]]:
    custom = p.get("custom_fields") or {}
    hist = custom.get("education_history")
    if isinstance(hist, list) and len(hist) > 0:
        out: list[dict[str, Any]] = []
        for row in hist:
            if not isinstance(row, dict):
                continue
            gy = row.get("graduation_year")
            gpa = row.get("gpa")
            out.append(
                {
                    "university": str(row.get("university") or ""),
                    "degree": str(row.get("degree") or ""),
                    "field_of_study": str(row.get("field_of_study") or ""),
                    "graduation_year": int(gy) if gy not in (None, "") else None,
                    "gpa": float(gpa) if gpa not in (None, "") else None,
                }
            )
        return out or [_empty_edu_row()]
    return [
        {
            "university": str(p.get("university") or ""),
            "degree": str(p.get("degree") or ""),
            "field_of_study": str(p.get("field_of_study") or ""),
            "graduation_year": p.get("graduation_year"),
            "gpa": p.get("gpa"),
        }
    ]


def parse_work_rows(p: dict[str, Any]) -> list[dict[str, Any]]:
    custom = p.get("custom_fields") or {}
    raw = custom.get("work_experience")
    if isinstance(raw, list) and len(raw) > 0:
        out: list[dict[str, Any]] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "job_title": str(row.get("job_title") or ""),
                    "company": str(row.get("company") or ""),
                    "location": str(row.get("location") or ""),
                    "start_month": str(row.get("start_month") or ""),
                    "start_year": str(row.get("start_year") or ""),
                    "end_month": str(row.get("end_month") or ""),
                    "end_year": str(row.get("end_year") or ""),
                    "description": str(row.get("description") or ""),
                }
            )
        return out or [_empty_work_row()]
    return [_empty_work_row()]


def work_row_has_content(row: dict[str, Any]) -> bool:
    keys = (
        "job_title",
        "company",
        "location",
        "start_month",
        "start_year",
        "end_month",
        "end_year",
        "description",
    )
    return any(str(row.get(k) or "").strip() for k in keys)


def hydrate_profile_widgets(profile: dict[str, Any]) -> None:
    pid = profile["id"]
    if st.session_state.get("_hydrated_profile_id") == pid:
        return
    st.session_state["_hydrated_profile_id"] = pid
    prefix = f"pf_{pid}_"
    st.session_state[f"{prefix}full_name"] = profile.get("full_name") or ""
    st.session_state[f"{prefix}phone"] = profile.get("phone") or ""
    st.session_state[f"{prefix}address_line1"] = profile.get("address_line1") or ""
    st.session_state[f"{prefix}address_line2"] = profile.get("address_line2") or ""
    st.session_state[f"{prefix}city"] = profile.get("city") or ""
    st.session_state[f"{prefix}state"] = profile.get("state") or ""
    st.session_state[f"{prefix}zip_code"] = profile.get("zip_code") or ""
    st.session_state[f"{prefix}country"] = profile.get("country") or ""
    st.session_state[f"{prefix}linkedin_url"] = profile.get("linkedin_url") or ""
    st.session_state[f"{prefix}portfolio_url"] = profile.get("portfolio_url") or ""
    st.session_state[f"{prefix}github_url"] = profile.get("github_url") or ""
    ye = profile.get("years_of_experience")
    st.session_state[f"{prefix}years_of_experience"] = str(ye) if ye is not None else ""
    st.session_state[f"{prefix}current_title"] = profile.get("current_title") or ""
    st.session_state[f"{prefix}current_company"] = profile.get("current_company") or ""
    st.session_state[f"{prefix}visa_status"] = profile.get("visa_status") or ""
    sn = profile.get("sponsorship_needed")
    if sn is True:
        st.session_state[f"{prefix}eeo_sponsor"] = "Yes"
    elif sn is False:
        st.session_state[f"{prefix}eeo_sponsor"] = "No"
    else:
        st.session_state[f"{prefix}eeo_sponsor"] = "No"

    wa = (profile.get("work_authorization") or "").strip().lower()
    if wa in ("yes", "y"):
        st.session_state[f"{prefix}eeo_auth"] = "Yes"
    elif wa in ("no", "n"):
        st.session_state[f"{prefix}eeo_auth"] = "No"
    else:
        st.session_state[f"{prefix}eeo_auth"] = "Yes"

    ds = (profile.get("disability_status") or "").strip().lower()
    if ds == "yes":
        st.session_state[f"{prefix}eeo_disability"] = "Yes"
    elif ds == "no":
        st.session_state[f"{prefix}eeo_disability"] = "No"
    else:
        st.session_state[f"{prefix}eeo_disability"] = "Prefer not to say"

    st.session_state[f"{prefix}eeo_gender"] = profile.get("gender") or ""

    vs = profile.get("veteran_status") or ""
    if vs == "veteran":
        st.session_state[f"{prefix}eeo_veteran"] = "Yes"
    elif vs == "not-veteran":
        st.session_state[f"{prefix}eeo_veteran"] = "No"
    else:
        st.session_state[f"{prefix}eeo_veteran"] = "Prefer not to say"

    cf = profile.get("custom_fields") or {}
    if not isinstance(cf, dict):
        cf = {}
    lg = str(cf.get("lgbtq") or cf.get("lgbtq_identity") or "").lower()
    if lg == "yes":
        st.session_state[f"{prefix}eeo_lgbtq"] = "Yes"
    elif lg == "no":
        st.session_state[f"{prefix}eeo_lgbtq"] = "No"
    elif lg in ("prefer_not", "prefer not"):
        st.session_state[f"{prefix}eeo_lgbtq"] = "Prefer not to say"
    else:
        st.session_state[f"{prefix}eeo_lgbtq"] = "Prefer not to say"

    race = (profile.get("ethnicity") or "").strip()
    if race in EEO_RACE_OPTIONS:
        st.session_state[f"{prefix}eeo_race"] = race
    else:
        st.session_state[f"{prefix}eeo_race"] = race or "Prefer not to say"

    hl = str(cf.get("hispanic_latino") or "").lower()
    if hl == "yes":
        st.session_state[f"{prefix}eeo_hispanic"] = "Yes"
    elif hl == "no":
        st.session_state[f"{prefix}eeo_hispanic"] = "No"
    elif hl in ("prefer_not", "prefer not"):
        st.session_state[f"{prefix}eeo_hispanic"] = "Prefer not to say"
    else:
        st.session_state[f"{prefix}eeo_hispanic"] = "Prefer not to say"

    so = (cf.get("sexual_orientation") or "").strip()
    if so in EEO_ORIENTATION_OPTIONS:
        st.session_state[f"{prefix}eeo_orientation"] = so
    else:
        st.session_state[f"{prefix}eeo_orientation"] = so or "Prefer not to say"
    st.session_state[f"{prefix}expected_salary"] = profile.get("expected_salary") or ""
    st.session_state[f"{prefix}current_salary"] = profile.get("current_salary") or ""
    st.session_state[f"{prefix}salary_currency"] = profile.get("salary_currency") or "USD"

    edu = parse_education_rows(profile)
    st.session_state[f"{prefix}edu_count"] = max(1, len(edu))
    for i, row in enumerate(edu):
        st.session_state[f"{prefix}edu_{i}_degree"] = row.get("degree") or ""
        st.session_state[f"{prefix}edu_{i}_field"] = row.get("field_of_study") or ""
        st.session_state[f"{prefix}edu_{i}_university"] = row.get("university") or ""
        gy = row.get("graduation_year")
        st.session_state[f"{prefix}edu_{i}_grad"] = str(gy) if gy is not None else ""
        gpa = row.get("gpa")
        st.session_state[f"{prefix}edu_{i}_gpa"] = str(gpa) if gpa is not None else ""

    work = parse_work_rows(profile)
    st.session_state[f"{prefix}work_count"] = max(1, len(work))
    for i, row in enumerate(work):
        for k in (
            "job_title",
            "company",
            "location",
            "start_month",
            "start_year",
            "end_month",
            "end_year",
            "description",
        ):
            st.session_state[f"{prefix}work_{i}_{k}"] = row.get(k) or ""


def collect_profile_payload(profile: dict[str, Any]) -> dict[str, Any] | None:
    pid = profile["id"]
    prefix = f"pf_{pid}_"
    try:
        ye_raw = (st.session_state.get(f"{prefix}years_of_experience") or "").strip()
        years_of_experience = int(ye_raw) if ye_raw else None
    except ValueError:
        st.error("Years of experience must be a whole number.")
        return None

    edu_count = int(st.session_state.get(f"{prefix}edu_count") or 1)
    education_rows: list[dict[str, Any]] = []
    for i in range(edu_count):
        gy_s = (st.session_state.get(f"{prefix}edu_{i}_grad") or "").strip()
        gpa_s = (st.session_state.get(f"{prefix}edu_{i}_gpa") or "").strip()
        try:
            gy = int(gy_s) if gy_s else None
        except ValueError:
            st.error(f"School {i + 1}: graduation year must be a number.")
            return None
        try:
            gpa = float(gpa_s) if gpa_s else None
        except ValueError:
            st.error(f"School {i + 1}: GPA must be a number.")
            return None
        education_rows.append(
            {
                "degree": st.session_state.get(f"{prefix}edu_{i}_degree") or "",
                "field_of_study": st.session_state.get(f"{prefix}edu_{i}_field") or "",
                "university": st.session_state.get(f"{prefix}edu_{i}_university") or "",
                "graduation_year": gy,
                "gpa": gpa,
            }
        )

    work_count = int(st.session_state.get(f"{prefix}work_count") or 1)
    work_rows: list[dict[str, Any]] = []
    for i in range(work_count):
        work_rows.append(
            {
                "job_title": st.session_state.get(f"{prefix}work_{i}_job_title") or "",
                "company": st.session_state.get(f"{prefix}work_{i}_company") or "",
                "location": st.session_state.get(f"{prefix}work_{i}_location") or "",
                "start_month": st.session_state.get(f"{prefix}work_{i}_start_month") or "",
                "start_year": st.session_state.get(f"{prefix}work_{i}_start_year") or "",
                "end_month": st.session_state.get(f"{prefix}work_{i}_end_month") or "",
                "end_year": st.session_state.get(f"{prefix}work_{i}_end_year") or "",
                "description": st.session_state.get(f"{prefix}work_{i}_description") or "",
            }
        )

    first_ed = education_rows[0] if education_rows else _empty_edu_row()

    es = (st.session_state.get(f"{prefix}eeo_sponsor") or "").strip()
    sponsorship_needed: bool | None
    if es == "Yes":
        sponsorship_needed = True
    elif es == "No":
        sponsorship_needed = False
    else:
        sponsorship_needed = None

    auth = (st.session_state.get(f"{prefix}eeo_auth") or "Yes").strip()
    work_authorization = "Yes" if auth == "Yes" else "No"

    ed = (st.session_state.get(f"{prefix}eeo_disability") or "").strip()
    if ed == "Yes":
        disability_status = "yes"
    elif ed == "No":
        disability_status = "no"
    else:
        disability_status = ""

    ev = (st.session_state.get(f"{prefix}eeo_veteran") or "").strip()
    if ev == "Yes":
        veteran_status = "veteran"
    elif ev == "No":
        veteran_status = "not-veteran"
    else:
        veteran_status = ""

    el = (st.session_state.get(f"{prefix}eeo_lgbtq") or "").strip()
    if el == "Yes":
        lgbtq_val = "yes"
    elif el == "No":
        lgbtq_val = "no"
    else:
        lgbtq_val = "prefer_not"

    eh = (st.session_state.get(f"{prefix}eeo_hispanic") or "").strip()
    if eh == "Yes":
        hispanic_val = "yes"
    elif eh == "No":
        hispanic_val = "no"
    else:
        hispanic_val = "prefer_not"

    race = (st.session_state.get(f"{prefix}eeo_race") or "").strip()
    orientation = (st.session_state.get(f"{prefix}eeo_orientation") or "").strip()

    custom = dict(profile.get("custom_fields") or {})
    if not isinstance(custom, dict):
        custom = {}
    custom["education_history"] = education_rows
    custom["work_experience"] = [w for w in work_rows if work_row_has_content(w)]
    custom["lgbtq"] = lgbtq_val
    custom["hispanic_latino"] = hispanic_val
    custom["sexual_orientation"] = orientation

    payload: dict[str, Any] = {
        "full_name": (st.session_state.get(f"{prefix}full_name") or "").strip(),
        "phone": (st.session_state.get(f"{prefix}phone") or "").strip(),
        "address_line1": (st.session_state.get(f"{prefix}address_line1") or "").strip(),
        "address_line2": (st.session_state.get(f"{prefix}address_line2") or "").strip(),
        "city": (st.session_state.get(f"{prefix}city") or "").strip(),
        "state": (st.session_state.get(f"{prefix}state") or "").strip(),
        "zip_code": (st.session_state.get(f"{prefix}zip_code") or "").strip(),
        "country": (st.session_state.get(f"{prefix}country") or "").strip(),
        "linkedin_url": (st.session_state.get(f"{prefix}linkedin_url") or "").strip(),
        "portfolio_url": (st.session_state.get(f"{prefix}portfolio_url") or "").strip(),
        "github_url": (st.session_state.get(f"{prefix}github_url") or "").strip(),
        "years_of_experience": years_of_experience,
        "current_title": (st.session_state.get(f"{prefix}current_title") or "").strip(),
        "current_company": (st.session_state.get(f"{prefix}current_company") or "").strip(),
        "visa_status": (st.session_state.get(f"{prefix}visa_status") or "").strip(),
        "work_authorization": work_authorization,
        "sponsorship_needed": sponsorship_needed,
        "gender": (st.session_state.get(f"{prefix}eeo_gender") or "").strip(),
        "ethnicity": race,
        "veteran_status": veteran_status,
        "disability_status": disability_status,
        "expected_salary": (st.session_state.get(f"{prefix}expected_salary") or "").strip(),
        "current_salary": (st.session_state.get(f"{prefix}current_salary") or "").strip(),
        "salary_currency": (st.session_state.get(f"{prefix}salary_currency") or "USD").strip(),
        "degree": first_ed.get("degree") or "",
        "field_of_study": first_ed.get("field_of_study") or "",
        "university": first_ed.get("university") or "",
        "graduation_year": first_ed.get("graduation_year"),
        "gpa": first_ed.get("gpa"),
        "custom_fields": custom,
    }
    return payload


def validate_profile(payload: dict[str, Any]) -> str | None:
    if not (payload.get("full_name") or "").strip():
        return "Full name is required for autofill quality."
    phone = (payload.get("phone") or "").strip()
    if phone and len(phone) < 7:
        return "Phone number looks too short."
    return None


# ── styles ────────────────────────────────────────────────────────────────────


def inject_styles() -> None:
    st.markdown(
        """
<style>
/* ══════════════════════════════════════════════════════════════
   JOBASSIST — Premium SaaS Dashboard
   Full-width, Apple-grade refinement
   ══════════════════════════════════════════════════════════════ */

@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');

/* ── 0. Root & Global ── */
:root {
    color-scheme: light !important;
    --bg: #f5f5f7;
    --surface: #ffffff;
    --surface-hover: #fafafa;
    --border: rgba(0,0,0,0.06);
    --border-strong: rgba(0,0,0,0.1);
    --accent: #6366f1;
    --accent-soft: rgba(99,102,241,0.08);
    --accent-border: rgba(99,102,241,0.15);
    --text: #1d1d1f;
    --text-secondary: #86868b;
    --text-tertiary: #aeaeb2;
    --radius: 14px;
    --radius-sm: 10px;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03);
    --shadow-lg: 0 2px 8px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);
    --font: 'DM Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
}

.stApp,
.stApp > header,
.main .block-container,
section[data-testid="stMain"],
div[data-testid="stAppViewBlockContainer"],
.stMainBlockContainer,
.stApp [data-testid="stAppViewContainer"] {
    background-color: var(--bg) !important;
    color: var(--text) !important;
    font-family: var(--font) !important;
}

/* ── 1. Kill ALL Streamlit chrome ── */
header[data-testid="stHeader"],
.stApp > header,
[data-testid="stToolbar"] {
    background-color: var(--bg) !important;
    border: none !important;
}
[data-testid="stDecoration"], .stDeployButton { display: none !important; }
#MainMenu, footer { visibility: hidden !important; }
[data-testid="stSidebar"] { display: none !important; }

/* ── 2. FULL WIDTH — override Streamlit's max-width ── */
.main .block-container,
.stMainBlockContainer,
div[data-testid="stAppViewBlockContainer"] {
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
}

section[data-testid="stMain"] > div {
    max-width: 100% !important;
    padding: 0 !important;
}

/* ── 3. Text inputs — refined ── */
div[data-baseweb="input"] {
    background-color: var(--surface) !important;
    border: 1.5px solid var(--border-strong) !important;
    border-radius: var(--radius-sm) !important;
    box-shadow: none !important;
    transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
}
div[data-baseweb="input"] > div {
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
div[data-baseweb="input"] input,
[data-testid="stTextInput"] input,
[data-testid="stNumberInput"] input {
    background-color: transparent !important;
    color: var(--text) !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    caret-color: var(--accent) !important;
    font-size: 14px !important;
    font-family: var(--font) !important;
    padding: 10px 14px !important;
}
div[data-baseweb="input"]:hover { border-color: rgba(0,0,0,0.18) !important; }
div[data-baseweb="input"]:focus-within {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px var(--accent-soft) !important;
}
div[data-baseweb="input"] input::placeholder { color: var(--text-tertiary) !important; }

/* ── 4. Textarea ── */
div[data-baseweb="textarea"],
[data-testid="stTextArea"] textarea {
    background-color: var(--surface) !important;
    color: var(--text) !important;
    border: 1.5px solid var(--border-strong) !important;
    border-radius: var(--radius-sm) !important;
    box-shadow: none !important;
    font-family: var(--font) !important;
}
div[data-baseweb="textarea"]:hover { border-color: rgba(0,0,0,0.18) !important; }
div[data-baseweb="textarea"]:focus-within,
[data-testid="stTextArea"] textarea:focus {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px var(--accent-soft) !important;
}

/* ── 5. Select / Dropdown ── */
[data-testid="stSelectbox"] [data-baseweb="select"] > div,
div[data-baseweb="select"] > div {
    background-color: var(--surface) !important;
    border: 1.5px solid var(--border-strong) !important;
    border-radius: var(--radius-sm) !important;
    box-shadow: none !important;
    color: var(--text) !important;
    font-family: var(--font) !important;
    min-height: 42px !important;
}
[data-testid="stSelectbox"] [data-baseweb="select"] > div:hover { border-color: rgba(0,0,0,0.18) !important; }
[data-testid="stSelectbox"] [data-baseweb="select"] > div:focus-within {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px var(--accent-soft) !important;
}
[data-testid="stSelectbox"] [data-baseweb="select"] span,
div[data-baseweb="select"] span,
.stSelectbox div[role="combobox"] * { color: var(--text) !important; font-family: var(--font) !important; }
[data-testid="stSelectbox"] svg, div[data-baseweb="select"] svg { fill: var(--text-tertiary) !important; }
[data-baseweb="popover"], [data-baseweb="popover"] > div,
ul[role="listbox"], div[data-baseweb="menu"] {
    background-color: var(--surface) !important;
    border: 1px solid var(--border-strong) !important;
    border-radius: 12px !important;
    box-shadow: var(--shadow-lg) !important;
}
ul[role="listbox"] li { color: var(--text) !important; background: transparent !important; font-family: var(--font) !important; border-radius: 8px !important; margin: 2px 4px !important; }
ul[role="listbox"] li:hover { background-color: var(--surface-hover) !important; }
ul[role="listbox"] li[aria-selected="true"] { background-color: var(--accent-soft) !important; color: var(--accent) !important; font-weight: 600 !important; }

/* ── 6. Labels ── */
.stMarkdown, .stText, label,
[data-testid="stWidgetLabel"] label,
[data-testid="stWidgetLabel"] p { color: var(--text-secondary) !important; font-size: 13px !important; font-family: var(--font) !important; }
.stMarkdown b, .stMarkdown strong { color: var(--text) !important; }

/* ── 7. Expanders — card style ── */
[data-testid="stExpander"] details {
    background: var(--surface) !important;
    border: 1px solid var(--border-strong) !important;
    border-radius: var(--radius) !important;
    overflow: hidden !important;
    box-shadow: var(--shadow-sm) !important;
}
[data-testid="stExpander"] summary {
    font-weight: 600 !important; font-size: 14px !important;
    color: var(--text) !important; padding: 16px 20px !important;
    background: transparent !important; font-family: var(--font) !important;
}
[data-testid="stExpander"] summary:hover { background: var(--surface-hover) !important; }
[data-testid="stExpander"] summary:focus,
[data-testid="stExpander"] summary:focus-visible,
[data-testid="stExpander"] details[open] > summary {
    background: transparent !important; color: var(--text) !important;
    outline: none !important; box-shadow: none !important;
}
[data-testid="stExpander"] details > div { border-top: 1px solid var(--border) !important; padding: 4px 4px 0 !important; }

/* ── 8. Bordered containers ── */
div[data-testid="stVerticalBlockBorderWrapper"] {
    border: 1px solid var(--border-strong) !important;
    border-radius: var(--radius-sm) !important;
    background: var(--surface) !important;
}

/* ── 9. Buttons ── */
button[kind="primary"],
div[data-testid="stFormSubmitButton"] button {
    background: var(--accent) !important;
    color: #fff !important;
    border: none !important;
    border-radius: var(--radius-sm) !important;
    font-weight: 600 !important;
    font-family: var(--font) !important;
    font-size: 13px !important;
    box-shadow: 0 1px 3px rgba(99,102,241,0.2) !important;
    transition: all 0.15s ease !important;
    padding: 8px 18px !important;
}
button[kind="primary"]:hover { box-shadow: 0 4px 14px rgba(99,102,241,0.3) !important; transform: translateY(-0.5px); }
button[kind="secondary"], .stButton > button {
    background: var(--surface) !important;
    color: var(--text-secondary) !important;
    border: 1.5px solid var(--border-strong) !important;
    border-radius: var(--radius-sm) !important;
    font-family: var(--font) !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    transition: all 0.15s ease !important;
    padding: 8px 18px !important;
}
button[kind="secondary"]:hover, .stButton > button:hover {
    border-color: var(--accent-border) !important;
    color: var(--accent) !important;
    background: var(--accent-soft) !important;
}
.stLinkButton > a, div[data-testid="stLinkButton"] > a {
    background: var(--accent) !important; color: #fff !important;
    border: none !important; border-radius: var(--radius-sm) !important;
    font-weight: 600 !important; text-decoration: none !important;
    font-family: var(--font) !important;
    box-shadow: 0 1px 3px rgba(99,102,241,0.2) !important;
}

/* ── 10. Tabs ── */
.stTabs [data-baseweb="tab-list"] { gap:0 !important; border-bottom: 1px solid var(--border) !important; background: transparent !important; }
.stTabs [data-baseweb="tab"] { color: var(--text-tertiary) !important; font-weight: 500 !important; background: transparent !important; border: none !important; font-family: var(--font) !important; }
.stTabs [data-baseweb="tab"]:hover { color: var(--text-secondary) !important; }
.stTabs [aria-selected="true"] { color: var(--accent) !important; font-weight: 700 !important; border-bottom: 2px solid var(--accent) !important; }
.stTabs [data-baseweb="tab-highlight"] { background-color: var(--accent) !important; }
.stTabs [data-baseweb="tab-border"] { display: none !important; }

/* ── 11. Checkboxes ── */
.stCheckbox label, .stCheckbox label span { color: var(--text) !important; }

/* ── 12. File uploader ── */
[data-testid="stFileUploader"], [data-testid="stFileUploader"] > div,
[data-testid="stFileUploader"] section { background: transparent !important; border: none !important; color: var(--text-secondary) !important; }
[data-testid="stFileUploader"] button { background: var(--surface) !important; border: 1.5px solid var(--border-strong) !important; color: var(--text) !important; border-radius: var(--radius-sm) !important; }

/* ── 13. Form container ── */
[data-testid="stForm"], [data-testid="stForm"] > div {
    background: var(--surface) !important; border: 1px solid var(--border-strong) !important; border-radius: var(--radius) !important;
}

/* ── 14. Alerts ── */
[data-testid="stAlert"] > div { border-radius: var(--radius-sm) !important; }

/* ── 15. Typography ── */
h1, h2, h3, h4, h5, h6 { color: var(--text) !important; font-family: var(--font) !important; }
h5 { font-size: 13px !important; }
a { color: var(--accent) !important; }

/* ── 16. Spacing ── */
div[data-testid="stVerticalBlock"] > div { gap: 0.4rem !important; }

/* ── 17. Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.18); }

/* ── 18. EEO rows ── */
.eeo-q { font-size: 13px; color: var(--text-secondary); margin: 0; padding: 10px 0 6px; line-height: 1.5; font-family: var(--font); }
.eeo-row-hr { border: none; border-top: 1px solid var(--border); margin: 0 0 4px; }

/* ══════════════════════════════════════════════════════════════
   SIDEBAR — flush left, full height, dark
   ══════════════════════════════════════════════════════════════ */

div[data-testid="stColumn"]:has(.nav-wrap) {
    background: #18181b !important;
    border-radius: 0 !important;
    padding: 0 !important;
    min-height: 100vh !important;
    position: sticky !important;
    top: 0 !important;
    border-right: 1px solid rgba(255,255,255,0.04) !important;
}

.nav-wrap {
    background: transparent !important;
    border: none !important;
    border-radius: 0;
    padding: 24px 16px 16px;
    margin-bottom: 0;
}

div[data-testid="stColumn"]:has(.nav-wrap) p,
div[data-testid="stColumn"]:has(.nav-wrap) span,
div[data-testid="stColumn"]:has(.nav-wrap) label,
div[data-testid="stColumn"]:has(.nav-wrap) .stMarkdown {
    color: rgba(255,255,255,0.45) !important;
    font-family: var(--font) !important;
}
div[data-testid="stColumn"]:has(.nav-wrap) b,
div[data-testid="stColumn"]:has(.nav-wrap) strong { color: #ffffff !important; }

/* Nav buttons */
div[data-testid="stColumn"]:has(.nav-wrap) button {
    background: transparent !important;
    color: rgba(255,255,255,0.45) !important;
    border: none !important;
    border-radius: var(--radius-sm) !important;
    font-family: var(--font) !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    padding: 10px 14px !important;
    transition: all 0.12s ease !important;
    text-align: left !important;
}
div[data-testid="stColumn"]:has(.nav-wrap) button:hover {
    background: rgba(255,255,255,0.05) !important;
    color: rgba(255,255,255,0.8) !important;
    border: none !important;
}
div[data-testid="stColumn"]:has(.nav-wrap) button[kind="primary"] {
    background: rgba(99,102,241,0.15) !important;
    color: #c7c8ff !important;
    font-weight: 600 !important;
    border: none !important;
    box-shadow: none !important;
    border-left: 3px solid var(--accent) !important;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0 !important;
    padding-left: 11px !important;
}

/* ══════════════════════════════════════════════════════════════
   COMPONENT STYLES
   ══════════════════════════════════════════════════════════════ */

.stat-card {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    padding: 22px 20px 18px;
    box-shadow: var(--shadow);
    position: relative;
    overflow: hidden;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.stat-card:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
}
.stat-card .icon-wrap {
    width: 40px; height: 40px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; margin-bottom: 14px;
}
.stat-card .num {
    font-size: 32px; font-weight: 800; line-height: 1;
    color: var(--text); letter-spacing: -0.03em;
    font-family: var(--font);
}
.stat-card .lbl {
    font-size: 13px; color: var(--text-secondary); font-weight: 500;
    margin-top: 6px; font-family: var(--font);
}
.stat-card .accent-line {
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 3px;
}

.app-row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px 18px;
    margin-bottom: 8px;
    transition: all 0.15s ease;
    box-shadow: var(--shadow-sm);
}
.app-row:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow);
    transform: translateY(-0.5px);
}

.muted { color: var(--text-secondary) !important; font-size: 13px; font-family: var(--font); }
.dim { color: var(--text-tertiary) !important; font-size: 11px; font-family: var(--font); }

/* Remove column gap in main layout to make it flush */
[data-testid="stHorizontalBlock"]:has(.nav-wrap) {
    gap: 0 !important;
}

/* Main content column padding */
div[data-testid="stColumn"]:has(.main-content-marker) {
    padding: 32px 40px 40px !important;
}
</style>
""",
        unsafe_allow_html=True,
    )


# ── UI bits ───────────────────────────────────────────────────────────────────


def fmt_app_date(iso_ts: str | None) -> str:
    if not iso_ts:
        return "—"
    try:
        ts = iso_ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts)
        return dt.strftime("%b %d, %Y")
    except (ValueError, TypeError):
        return iso_ts[:10] if iso_ts else "—"


def portal_host(url: str | None) -> str:
    if not url:
        return "—"
    try:
        p = urlparse(url)
        if p.netloc:
            return p.netloc
        return url[:48] + ("…" if len(url) > 48 else "")
    except Exception:
        return url[:40]


def format_status_option(s: str) -> str:
    return s.replace("_", " ").title()


def status_meta(status: str | None) -> tuple[str, str, str]:
    key = (status or "").strip().lower()
    mapping: dict[str, tuple[str, str, str]] = {
        "applied": ("Applied", "#6366f1", "rgba(99,102,241,0.08)"),
        "assessment": ("Assessment", "#8b5cf6", "rgba(139,92,246,0.08)"),
        "interview_round_1": ("Interview R1", "#a855f7", "rgba(168,85,247,0.08)"),
        "interview_round_2": ("Interview R2", "#a855f7", "rgba(168,85,247,0.08)"),
        "interview_round_3": ("Interview R3", "#a855f7", "rgba(168,85,247,0.08)"),
        "offer": ("Offer", "#22c55e", "rgba(34,197,94,0.08)"),
        "rejected": ("Rejected", "#ef4444", "rgba(239,68,68,0.06)"),
        "withdrawn": ("Withdrawn", "#a1a1aa", "rgba(161,161,170,0.1)"),
    }
    return mapping.get(key, ("Pending", "#f59e0b", "rgba(245,158,11,0.08)"))


def status_badge_html(status: str | None) -> str:
    label, fg, bg = status_meta(status)
    return (
        f'<span style="font-size:11px;font-weight:600;color:{fg};'
        f'background:{bg};padding:4px 12px;border-radius:20px;'
        f'border:1px solid {fg}18;letter-spacing:0.01em;'
        f'font-family:var(--font);">{escape(label)}</span>'
    )


def parse_created_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=None)
    except ValueError:
        return None


def render_eeo_section(prefix: str) -> None:
    def row(question: str, state_key: str, options: list[str], *, first: bool = False) -> None:
        if not first:
            st.markdown('<hr class="eeo-row-hr"/>', unsafe_allow_html=True)
        c1, c2 = st.columns([0.58, 0.42])
        with c1:
            st.markdown(f'<p class="eeo-q">{escape(question)}</p>', unsafe_allow_html=True)
        with c2:
            st.selectbox(
                " ",
                options=options,
                key=f"{prefix}{state_key}",
                label_visibility="collapsed",
            )

    row("Are you authorized to work in the US?", "eeo_auth", ["Yes", "No"], first=True)
    row("Do you have a disability?", "eeo_disability", ["Yes", "No", "Prefer not to say"])
    st.markdown('<hr class="eeo-row-hr"/>', unsafe_allow_html=True)
    c1, c2 = st.columns([0.58, 0.42])
    with c1:
        st.markdown('<p class="eeo-q">What is your gender?</p>', unsafe_allow_html=True)
    with c2:
        st.selectbox(
            " ",
            options=GENDER_OPTS,
            format_func=lambda x: GENDER_LABEL.get(x, x),
            key=f"{prefix}eeo_gender",
            label_visibility="collapsed",
        )
    row(
        "Will you now or in the future require sponsorship for employment visa status?",
        "eeo_sponsor",
        ["Yes", "No"],
    )
    row("Do you identify as LGBTQ+?", "eeo_lgbtq", ["Yes", "No", "Prefer not to say"])
    row("Are you a veteran?", "eeo_veteran", ["Yes", "No", "Prefer not to say"])
    st.markdown('<hr class="eeo-row-hr"/>', unsafe_allow_html=True)
    c1, c2 = st.columns([0.58, 0.42])
    with c1:
        st.markdown('<p class="eeo-q">How would you identify your race?</p>', unsafe_allow_html=True)
    with c2:
        st.selectbox(
            " ",
            options=EEO_RACE_OPTIONS,
            key=f"{prefix}eeo_race",
            label_visibility="collapsed",
        )
    row("Are you Hispanic or Latino?", "eeo_hispanic", ["Yes", "No", "Prefer not to say"])
    st.markdown('<hr class="eeo-row-hr"/>', unsafe_allow_html=True)
    c1, c2 = st.columns([0.58, 0.42])
    with c1:
        st.markdown(
            '<p class="eeo-q">How would you describe your sexual orientation?</p>',
            unsafe_allow_html=True,
        )
    with c2:
        st.selectbox(
            " ",
            options=EEO_ORIENTATION_OPTIONS,
            key=f"{prefix}eeo_orientation",
            label_visibility="collapsed",
        )


def compute_stats(apps: list[dict[str, Any]]) -> dict[str, int]:
    total = len(apps)
    n_interview = sum(
        1
        for a in apps
        if (a.get("status") or "") == "assessment" or "interview" in (a.get("status") or "")
    )
    n_offer = sum(1 for a in apps if (a.get("status") or "") == "offer")
    n_pending = sum(
        1 for a in apps if (a.get("status") or "") in ("applied", "assessment")
    )
    return {"total": total, "interview": n_interview, "offered": n_offer, "pending": n_pending}


def applications_subtitle(apps: list[dict[str, Any]]) -> str:
    stats = compute_stats(apps)
    return f"{stats['total']} total · {stats['interview']} interviewing · {stats['offered']} offers"


def _filter_matches_application(f: str, a: dict[str, Any]) -> bool:
    if f == "all":
        return True
    if f == "interview":
        stt = (a.get("status") or "").lower()
        return stt == "assessment" or "interview" in stt
    return (a.get("status") or "") == f


def render_login(backend_url: str, app_url: str) -> None:
    # Centered login card
    _, center, _ = st.columns([1.5, 1, 1.5])
    with center:
        st.markdown(
            '<div style="text-align:center;padding:80px 0 40px;">'
            '<div style="width:64px;height:64px;border-radius:18px;'
            'background:linear-gradient(135deg,#6366f1,#818cf8);'
            'display:inline-flex;align-items:center;justify-content:center;'
            'box-shadow:0 4px 20px rgba(99,102,241,0.35);margin-bottom:20px;">'
            '<span style="font-size:28px;color:#fff;">⚡</span></div>'
            '<h1 style="font-size:28px;font-weight:800;margin:0 0 6px;letter-spacing:-0.03em;">JobAssist</h1>'
            '<p style="font-size:15px;color:#86868b;margin:0 0 32px;">AI-powered job application assistant</p>'
            '</div>',
            unsafe_allow_html=True,
        )

        query_params = st.query_params
        login_code = query_params.get("code")
        if login_code:
            with st.spinner("Completing sign-in..."):
                if exchange_web_login_code(backend_url, login_code):
                    st.success("Signed in successfully.")
                    st.rerun()

        login_url = f"{backend_url}/auth/web/google/start?next={quote_plus(app_url)}"
        st.link_button("Sign in with Google", login_url, type="primary", use_container_width=True)
        st.markdown(
            '<p style="font-size:12px;color:#aeaeb2;text-align:center;margin-top:16px;line-height:1.6;">'
            'Preferred: sign in from the Chrome extension first.<br>'
            'If access is denied, your email is not yet active in the whitelist.</p>',
            unsafe_allow_html=True,
        )


def render_profile_form(backend_url: str, profile: dict[str, Any]) -> None:
    hydrate_profile_widgets(profile)
    pid = profile["id"]
    prefix = f"pf_{pid}_"
    email = profile.get("email") or ""
    initial = (profile.get("full_name") or email or "?")[:1].upper()

    st.markdown(
        f'<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;'
        f'padding:20px 24px;background:var(--surface);border:1px solid var(--border-strong);'
        f'border-radius:16px;box-shadow:var(--shadow);">'
        f'<div style="width:52px;height:52px;border-radius:50%;flex-shrink:0;'
        f'background:linear-gradient(135deg,#6366f1,#818cf8);'
        f'display:flex;align-items:center;justify-content:center;'
        f'font-size:20px;font-weight:700;color:#fff;">{escape(initial)}</div>'
        f'<div><div style="font-size:18px;font-weight:700;color:var(--text);'
        f'font-family:var(--font);letter-spacing:-0.02em;">'
        f'{escape(profile.get("full_name") or "Your name")}</div>'
        f'<div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">{escape(email)}</div></div></div>',
        unsafe_allow_html=True,
    )

    with st.expander("Basic info", expanded=True):
        st.text_input("Full name", key=f"{prefix}full_name")
        st.markdown(
            f'<p style="font-size:12px;color:var(--text-tertiary);margin:0 0 8px;">'
            f'<strong style="color:var(--text-secondary);">Email</strong> (from Google): {escape(email)}</p>',
            unsafe_allow_html=True,
        )
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("Phone", key=f"{prefix}phone")
        with c2:
            st.text_input("Address line 1", key=f"{prefix}address_line1")
        st.text_input("Address line 2", key=f"{prefix}address_line2")
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("City", key=f"{prefix}city")
        with c2:
            st.text_input("State", key=f"{prefix}state")
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("Zip code", key=f"{prefix}zip_code")
        with c2:
            st.text_input("Country", key=f"{prefix}country")
        st.text_input(
            "Visa status (optional)",
            key=f"{prefix}visa_status",
            placeholder="e.g. F-1, H-1B, Green Card",
        )

    with st.expander("Professional", expanded=False):
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("LinkedIn URL", key=f"{prefix}linkedin_url")
        with c2:
            st.text_input("Portfolio / Website", key=f"{prefix}portfolio_url")
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("GitHub URL", key=f"{prefix}github_url")
        with c2:
            st.text_input("Years of experience", key=f"{prefix}years_of_experience")
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("Current title", key=f"{prefix}current_title")
        with c2:
            st.text_input("Current company", key=f"{prefix}current_company")
        st.caption("Work history (one block per role).")
        wc = int(st.session_state.get(f"{prefix}work_count") or 1)
        for i in range(wc):
            try:
                exp_box = st.container(border=True)
            except TypeError:
                exp_box = st.container()
            with exp_box:
                st.markdown(f"##### Experience {i + 1}")
                st.text_input("Job title", key=f"{prefix}work_{i}_job_title")
                st.text_input("Company", key=f"{prefix}work_{i}_company")
                st.text_input("Location", key=f"{prefix}work_{i}_location")
                c1, c2 = st.columns(2)
                with c1:
                    st.text_input("Start month", key=f"{prefix}work_{i}_start_month")
                with c2:
                    st.text_input("Start year", key=f"{prefix}work_{i}_start_year")
                c1, c2 = st.columns(2)
                with c1:
                    st.text_input("End month", key=f"{prefix}work_{i}_end_month")
                with c2:
                    st.text_input("End year", key=f"{prefix}work_{i}_end_year")
                st.text_area("Role description", key=f"{prefix}work_{i}_description", height=90)
        if wc > 1:
            if st.button("Remove last experience", key=f"{prefix}btn_rm_work"):
                st.session_state[f"{prefix}work_count"] = wc - 1
                st.rerun()
        if st.button("+ Add another experience", key=f"{prefix}btn_add_work"):
            st.session_state[f"{prefix}work_count"] = wc + 1
            ni = wc
            for k in (
                "job_title",
                "company",
                "location",
                "start_month",
                "start_year",
                "end_month",
                "end_year",
                "description",
            ):
                st.session_state[f"{prefix}work_{ni}_{k}"] = ""
            st.rerun()

    with st.expander("Education", expanded=False):
        ec = int(st.session_state.get(f"{prefix}edu_count") or 1)
        for i in range(ec):
            try:
                edu_box = st.container(border=True)
            except TypeError:
                edu_box = st.container()
            with edu_box:
                st.markdown(f"##### School {i + 1}")
                st.text_input("Degree", key=f"{prefix}edu_{i}_degree")
                st.text_input("Field of study", key=f"{prefix}edu_{i}_field")
                st.text_input("University", key=f"{prefix}edu_{i}_university")
                c1, c2 = st.columns(2)
                with c1:
                    st.text_input("Graduation year", key=f"{prefix}edu_{i}_grad")
                with c2:
                    st.text_input("GPA", key=f"{prefix}edu_{i}_gpa")
        if ec > 1:
            if st.button("Remove last school", key=f"{prefix}btn_rm_edu"):
                st.session_state[f"{prefix}edu_count"] = ec - 1
                st.rerun()
        if st.button("+ Add another school", key=f"{prefix}btn_add_edu"):
            st.session_state[f"{prefix}edu_count"] = ec + 1
            ni = ec
            st.session_state[f"{prefix}edu_{ni}_degree"] = ""
            st.session_state[f"{prefix}edu_{ni}_field"] = ""
            st.session_state[f"{prefix}edu_{ni}_university"] = ""
            st.session_state[f"{prefix}edu_{ni}_grad"] = ""
            st.session_state[f"{prefix}edu_{ni}_gpa"] = ""
            st.rerun()

    with st.expander("Equal Employment (EEO)", expanded=False):
        render_eeo_section(prefix)

    with st.expander("Salary", expanded=False):
        c1, c2 = st.columns(2)
        with c1:
            st.text_input("Expected salary", key=f"{prefix}expected_salary")
        with c2:
            st.text_input("Current salary", key=f"{prefix}current_salary")
        st.selectbox("Currency", options=SALARY_CURRENCIES, key=f"{prefix}salary_currency")

    if st.button("Save profile", type="primary", key=f"{prefix}save_profile"):
        payload = collect_profile_payload(profile)
        if payload is None:
            return
        err = validate_profile(payload)
        if err:
            st.warning(err)
            return
        response = api_request(backend_url, "/users/me/profile", method="PATCH", json_body=payload)
        if response.ok:
            st.session_state["profile"] = response.json()
            st.session_state["_hydrated_profile_id"] = None
            st.success("Profile updated.")
            st.rerun()
        else:
            st.error(f"Failed to save profile: {response.text}")


def render_resume_page(backend_url: str) -> None:
    r = api_request(backend_url, "/resumes")
    if not r.ok:
        st.error(f"Failed to list resumes: {r.text}")
        return
    resumes: list[dict[str, Any]] = r.json()

    if not resumes:
        st.caption("No resumes yet. Upload your first one below.")

    for item in resumes:
        rid = int(item["id"])
        c1, c2 = st.columns([6, 1])
        with c1:
            cs = " · Client-stored" if item.get("client_stored") else ""
            size_kb = item.get("size_bytes", 0) // 1024
            st.markdown(
                f'<div style="display:flex;align-items:center;gap:14px;background:var(--surface);'
                f'border:1px solid var(--border-strong);border-radius:14px;padding:16px 20px;'
                f'margin-bottom:8px;box-shadow:var(--shadow-sm);transition:all 0.15s ease;">'
                f'<div style="width:40px;height:40px;border-radius:11px;'
                f'background:var(--accent-soft);border:1px solid var(--accent-border);'
                f'display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
                f'<span style="font-size:18px;">📄</span></div>'
                f'<div style="min-width:0;flex:1;">'
                f'<div style="font-size:14px;font-weight:600;color:var(--text);'
                f'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                f'{escape(item.get("original_filename") or "Resume")}</div>'
                f'<div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">'
                f'{size_kb} KB{escape(cs)}</div></div></div>',
                unsafe_allow_html=True,
            )
        with c2:
            st.markdown('<div style="padding-top:12px;"></div>', unsafe_allow_html=True)
            if st.button("Delete", key=f"del_resume_{rid}", type="secondary"):
                with st.spinner("Removing…"):
                    d = api_delete_resume(backend_url, rid)
                if d.status_code == 204:
                    st.rerun()
                else:
                    st.error(f"Delete failed: {d.text}")

    if len(resumes) < MAX_RESUMES:
        st.markdown(
            '<div style="border:2px dashed var(--border-strong);border-radius:16px;'
            'padding:40px 20px;text-align:center;margin-top:16px;'
            'background:var(--surface);transition:border-color 0.15s;">'
            '<div style="font-size:28px;margin-bottom:10px;opacity:0.5;">↑</div>'
            '<p style="font-size:14px;font-weight:500;color:var(--text-secondary);margin:0;">'
            'Drop a resume here or browse below</p>'
            '<p style="font-size:12px;color:var(--text-tertiary);margin:6px 0 0 0;">'
            '.docx, .doc, or .pdf · max 10 MB</p></div>',
            unsafe_allow_html=True,
        )
        uploader_key = f"resume_uploader_{st.session_state.get('resume_uploader_nonce', 0)}"
        up = st.file_uploader(
            "Browse files",
            type=["docx", "doc", "pdf"],
            label_visibility="collapsed",
            key=uploader_key,
        )
        if up is not None:
            token = f"{getattr(up, 'file_id', '')}:{up.name}:{getattr(up, 'size', 0)}"
            if st.session_state.get("resume_last_upload_token") != token:
                st.session_state["resume_last_upload_token"] = token
                data = up.getvalue()
                with st.spinner("Uploading…"):
                    resp = api_upload_resume(backend_url, data, up.name)
                if resp.ok:
                    st.session_state["resume_uploader_nonce"] = int(
                        st.session_state.get("resume_uploader_nonce", 0)
                    ) + 1
                    st.session_state["resume_last_upload_token"] = None
                    st.rerun()
                else:
                    st.session_state["resume_last_upload_token"] = None
                    st.error(f"Upload failed: {resp.text}")
    else:
        st.info(f"Maximum of {MAX_RESUMES} resumes reached. Remove one to upload another.")


def render_settings_page(backend_url: str, profile: dict[str, Any]) -> None:
    st.markdown(
        '<div style="background:var(--surface);border:1px solid var(--border-strong);'
        'border-radius:16px;padding:24px;box-shadow:var(--shadow);margin-bottom:16px;">'
        '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;">AI Model</div>'
        '<div style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:16px;">'
        'Provide your own Gemini API key for resume tailoring and cover letter generation.</div>',
        unsafe_allow_html=True,
    )

    cf = profile.get("custom_fields") or {}
    if not isinstance(cf, dict):
        cf = {}
    existing_key = str(cf.get("llm_api_key") or "").strip()
    if existing_key:
        masked = f"••••••••{existing_key[-4:]}" if len(existing_key) >= 4 else "••••"
        st.markdown(
            f'<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">'
            f'Current key: <code style="background:var(--bg);padding:2px 6px;border-radius:4px;">'
            f'{masked}</code></div>',
            unsafe_allow_html=True,
        )

    st.text_input(
        "LLM API Key",
        key="settings_llm_api_key",
        type="password",
        placeholder="Paste your Gemini API key",
    )
    if st.button("Save API key", type="primary", key="btn_save_llm_key"):
        new_key = (st.session_state.get("settings_llm_api_key") or "").strip()
        if not new_key:
            st.warning("Please paste a valid API key.")
            return
        payload = {"custom_fields": {**cf, "llm_api_key": new_key}}
        resp = api_request(backend_url, "/users/me/profile", method="PATCH", json_body=payload)
        if resp.ok:
            st.session_state["profile"] = resp.json()
            st.session_state["settings_llm_api_key"] = ""
            st.success("API key saved.")
            st.rerun()
        else:
            st.error(f"Failed to save API key: {resp.text}")

    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(
        '<div style="background:var(--surface);border:1px solid var(--border-strong);'
        'border-radius:16px;padding:24px;box-shadow:var(--shadow);margin-top:16px;">'
        '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;">Account</div>'
        '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">'
        'Sign out of your current session.</div>',
        unsafe_allow_html=True,
    )
    if st.button("Sign out", type="secondary", key="btn_settings_signout"):
        clear_auth_state()
        st.rerun()
    st.markdown('</div>', unsafe_allow_html=True)


def render_dashboard(applications: list[dict[str, Any]]) -> None:
    stats = compute_stats(applications)
    stat_cards = [
        ("Total Applied", stats["total"], "#6366f1", "rgba(99,102,241,0.08)", "📋"),
        ("Interviews", stats["interview"], "#a855f7", "rgba(168,85,247,0.08)", "💬"),
        ("Offers", stats["offered"], "#22c55e", "rgba(34,197,94,0.08)", "✨"),
        ("Pending", stats["pending"], "#f59e0b", "rgba(245,158,11,0.08)", "⏳"),
    ]

    cards_html = ""
    for label, v, color, bg, icon in stat_cards:
        cards_html += (
            f'<div class="stat-card">'
            f'<div class="icon-wrap" style="background:{bg};">'
            f'<span>{icon}</span></div>'
            f'<div class="num">{v}</div>'
            f'<div class="lbl">{escape(label)}</div>'
            f'<div class="accent-line" style="background:linear-gradient(90deg,{color},{color}00);"></div>'
            f'</div>'
        )
    st.markdown(
        f'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;">{cards_html}</div>',
        unsafe_allow_html=True,
    )

    left_col, right_col = st.columns([2.2, 1.0])
    with left_col:
        # Recent applications card
        st.markdown(
            '<div style="background:var(--surface);border:1px solid var(--border-strong);'
            'border-radius:16px;padding:20px 24px;box-shadow:var(--shadow);">',
            unsafe_allow_html=True,
        )
        card_top_left, card_top_right = st.columns([3, 1])
        with card_top_left:
            st.markdown(
                '<p style="font-size:16px;font-weight:700;margin:0 0 4px;color:var(--text);'
                'letter-spacing:-0.01em;">Recent Applications</p>',
                unsafe_allow_html=True,
            )
        with card_top_right:
            if st.button("View all →", key="btn_view_all_apps"):
                st.session_state.main_nav = "applications"
                st.rerun()

        recent = sorted(
            applications,
            key=lambda a: parse_created_date(a.get("created_at")) or datetime.min,
            reverse=True,
        )[:5]
        if not recent:
            st.markdown(
                '<div style="padding:24px 0;text-align:center;">'
                '<p style="font-size:14px;color:var(--text-secondary);">No applications yet. '
                'Start one from the Chrome extension.</p></div>',
                unsafe_allow_html=True,
            )
        for idx, a in enumerate(recent):
            aid = int(a["id"])
            co = (a.get("company_name") or "Company").strip() or "Company"
            role = (a.get("role_title") or "").strip() or "Role"
            date_txt = fmt_app_date(str(a.get("created_at")) if a.get("created_at") else None)
            initial = co[:1].upper()
            _, fg, _ = status_meta(a.get("status"))

            separator = f'<div style="height:1px;background:var(--border);margin:10px 0;"></div>' if idx > 0 else ""
            st.markdown(
                f'{separator}'
                f'<div style="display:flex;align-items:center;gap:14px;padding:6px 0;">'
                f'<div style="width:40px;height:40px;border-radius:11px;flex-shrink:0;'
                f'background:linear-gradient(135deg,{fg}15,{fg}08);'
                f'border:1px solid {fg}20;'
                f'display:flex;align-items:center;justify-content:center;'
                f'font-size:15px;font-weight:700;color:{fg};">{escape(initial)}</div>'
                f'<div style="flex:1;min-width:0;">'
                f'<div style="font-size:14px;font-weight:600;color:var(--text);">{escape(co)}</div>'
                f'<div style="font-size:12px;color:var(--text-secondary);margin-top:1px;'
                f'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{escape(role)}</div></div>'
                f'<div style="text-align:right;flex-shrink:0;">'
                f'<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">{escape(date_txt)}</div>'
                f'{status_badge_html(a.get("status"))}</div></div>',
                unsafe_allow_html=True,
            )
        st.markdown('</div>', unsafe_allow_html=True)

    with right_col:
        # Pipeline card
        st.markdown(
            '<div style="background:var(--surface);border:1px solid var(--border-strong);'
            'border-radius:16px;padding:20px;box-shadow:var(--shadow);margin-bottom:14px;">',
            unsafe_allow_html=True,
        )
        st.markdown(
            '<p style="font-size:16px;font-weight:700;margin:0 0 12px;color:var(--text);'
            'letter-spacing:-0.01em;">Pipeline</p>',
            unsafe_allow_html=True,
        )
        d1, d3, d7 = st.columns(3)
        for n, col in ((1, d1), (3, d3), (7, d7)):
            with col:
                active = st.session_state.pipeline_days == n
                if st.button(
                    f"{n}d",
                    key=f"btn_pipeline_{n}",
                    use_container_width=True,
                    type="primary" if active else "secondary",
                ):
                    st.session_state.pipeline_days = n
                    st.rerun()

        now = datetime.utcnow()
        filtered = [
            a
            for a in applications
            if (parse_created_date(a.get("created_at")) or datetime.min)
            >= (now.replace(tzinfo=None) - timedelta(days=st.session_state.pipeline_days))
        ]
        rows = [
            ("Applied", sum(1 for a in filtered if (a.get("status") or "") == "applied"), "#6366f1"),
            ("Assessment", sum(1 for a in filtered if (a.get("status") or "") == "assessment"), "#8b5cf6"),
            ("Interview", sum(1 for a in filtered if "interview" in (a.get("status") or "")), "#a855f7"),
            ("Offer", sum(1 for a in filtered if (a.get("status") or "") == "offer"), "#22c55e"),
            ("Rejected", sum(1 for a in filtered if (a.get("status") or "") == "rejected"), "#ef4444"),
        ]
        max_n = max((n for _, n, _ in rows), default=1) or 1
        for label, n, c in rows:
            pct = int((n / max_n) * 100) if (max_n and n > 0) else 0
            st.markdown(
                f'<div style="margin-bottom:10px;">'
                f'<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">'
                f'<span style="color:var(--text-secondary);font-weight:500;">{label}</span>'
                f'<span style="color:{c};font-weight:700;">{n}</span></div>'
                f'<div style="height:6px;border-radius:3px;background:var(--bg);overflow:hidden;">'
                f'<div style="height:100%;width:{pct}%;background:{c};border-radius:3px;'
                f'transition:width 0.3s ease;"></div></div></div>',
                unsafe_allow_html=True,
            )
        st.markdown('</div>', unsafe_allow_html=True)

        # Activity card
        st.markdown(
            '<div style="background:var(--surface);border:1px solid var(--border-strong);'
            'border-radius:16px;padding:20px;box-shadow:var(--shadow);">',
            unsafe_allow_html=True,
        )
        st.markdown(
            '<p style="font-size:16px;font-weight:700;margin:0 0 14px;color:var(--text);'
            'letter-spacing:-0.01em;">Activity</p>',
            unsafe_allow_html=True,
        )
        act = sorted(
            applications,
            key=lambda a: parse_created_date(a.get("created_at")) or datetime.min,
            reverse=True,
        )[:5]
        if not act:
            st.markdown(
                '<p style="font-size:13px;color:var(--text-tertiary);">No activity yet.</p>',
                unsafe_allow_html=True,
            )
        for a in act:
            label, color, _ = status_meta(a.get("status"))
            co = (a.get("company_name") or "Company").strip() or "Company"
            st.markdown(
                f'<div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;">'
                f'<div style="width:7px;height:7px;border-radius:50%;background:{color};'
                f'margin-top:5px;flex-shrink:0;"></div>'
                f'<div><div style="font-size:13px;color:var(--text);font-weight:500;">'
                f'{escape(label)} — {escape(co)}</div>'
                f'<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">'
                f'{escape(fmt_app_date(str(a.get("created_at")) if a.get("created_at") else None))}</div></div></div>',
                unsafe_allow_html=True,
            )
        st.markdown('</div>', unsafe_allow_html=True)


def _patch_app_status_streamlit(backend_url: str, application_id: int) -> None:
    key = f"app_row_status_{application_id}"
    val = st.session_state.get(key)
    if val not in APPLICATION_STATUSES:
        return
    r = api_request(
        backend_url,
        f"/me/applications/{application_id}/status",
        method="PATCH",
        json_body={"status": val},
    )
    if r.ok:
        st.session_state.pop(f"app_status_err_{application_id}", None)
        st.rerun()
    else:
        st.session_state[f"app_status_err_{application_id}"] = r.text or "Update failed"


def render_applications_page(backend_url: str, applications: list[dict[str, Any]]) -> None:
    st.markdown(
        f'<p style="font-size:14px;color:var(--text-secondary);margin:0 0 20px 0;font-weight:400;">'
        f'{escape(applications_subtitle(applications))}</p>',
        unsafe_allow_html=True,
    )

    st.markdown(
        '<p style="font-size:12px;color:var(--text-tertiary);margin:0 0 16px;line-height:1.5;">'
        'Start a new application from the <strong style="color:var(--text-secondary);">Chrome extension</strong> '
        '(JobAssist side panel). This page tracks status for applications already synced.</p>',
        unsafe_allow_html=True,
    )

    filter_options = ["all", "interview"] + APPLICATION_STATUSES
    if st.session_state.apps_filter not in filter_options:
        st.session_state.apps_filter = "all"

    def _fmt_filter(x: str) -> str:
        if x == "all":
            return "All statuses"
        if x == "interview":
            return "Interview pipeline"
        return format_status_option(x)

    row1_c1, row1_c2 = st.columns([5, 1.5])
    with row1_c1:
        st.text_input(
            "Search",
            key="apps_search",
            placeholder="Search companies or roles…",
            label_visibility="collapsed",
        )
    with row1_c2:
        st.selectbox(
            "Filter",
            options=filter_options,
            key="apps_filter",
            format_func=_fmt_filter,
            label_visibility="collapsed",
        )

    q = (st.session_state.apps_search or "").lower().strip()
    f = st.session_state.apps_filter
    filtered = [
        a
        for a in applications
        if _filter_matches_application(f, a)
        and (
            not q
            or q in (a.get("company_name") or "").lower()
            or q in (a.get("role_title") or "").lower()
        )
    ]

    selected = st.session_state.get("selected_application_id")
    if selected:
        app = next((a for a in applications if int(a["id"]) == int(selected)), None)
        if app is None:
            st.session_state["selected_application_id"] = None
            st.rerun()
        if st.button("← Back"):
            st.session_state["selected_application_id"] = None
            st.rerun()
        co = (app.get("company_name") or "Company").strip() or "Company"
        role = (app.get("role_title") or "").strip() or "Role"
        host = portal_host(app.get("portal_url") or "")
        status = app.get("status") or "applied"
        _, fg, _ = status_meta(status)
        st.markdown(
            f'<div style="background:var(--surface);border:1px solid var(--border-strong);'
            f'border-radius:16px;padding:24px;box-shadow:var(--shadow);margin-bottom:16px;">'
            f'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
            f'<div style="display:flex;align-items:center;gap:14px;">'
            f'<div style="width:48px;height:48px;border-radius:13px;'
            f'background:linear-gradient(135deg,{fg}15,{fg}08);border:1px solid {fg}20;'
            f'display:flex;align-items:center;justify-content:center;'
            f'font-size:20px;font-weight:800;color:{fg};">{escape(co[:1].upper())}</div>'
            f'<div><div style="font-size:20px;font-weight:800;color:var(--text);'
            f'letter-spacing:-0.02em;">{escape(co)}</div>'
            f'<div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">{escape(role)}</div></div></div>'
            f'<div>{status_badge_html(status)}</div></div>'
            f'<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);'
            f'font-size:12px;color:var(--text-tertiary);">'
            f'Portal: {escape(host)} · Applied: {escape(fmt_app_date(str(app.get("created_at")) if app.get("created_at") else None))}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )
        key = f"detail_status_{selected}"
        if key not in st.session_state:
            st.session_state[key] = status if status in APPLICATION_STATUSES else "applied"
        st.selectbox(
            "Update status",
            APPLICATION_STATUSES,
            key=key,
            format_func=format_status_option,
        )
        if st.button("Save status", type="primary"):
            resp = api_request(
                backend_url,
                f"/me/applications/{selected}/status",
                method="PATCH",
                json_body={"status": st.session_state.get(key)},
            )
            if resp.ok:
                st.success("Status updated.")
                st.rerun()
            else:
                st.error(f"Update failed: {resp.text}")
        return

    if not filtered:
        st.markdown(
            '<div style="border-radius:16px;border:1px solid var(--border-strong);'
            'background:var(--surface);padding:56px 20px;text-align:center;box-shadow:var(--shadow);">'
            '<div style="font-size:36px;margin-bottom:12px;opacity:0.4;">🔍</div>'
            '<p style="font-size:16px;font-weight:600;color:var(--text);margin:0 0 4px;">No applications found</p>'
            '<p style="font-size:13px;color:var(--text-secondary);margin:0;">Try adjusting your search or filter</p></div>',
            unsafe_allow_html=True,
        )
        return

    # Application list inside a card
    st.markdown(
        '<div style="background:var(--surface);border:1px solid var(--border-strong);'
        'border-radius:16px;overflow:hidden;box-shadow:var(--shadow);">',
        unsafe_allow_html=True,
    )

    for i, a in enumerate(filtered):
        aid = int(a["id"])
        co = (a.get("company_name") or "Company").strip() or "Company"
        role = (a.get("role_title") or "").strip() or "Role"
        date_txt = fmt_app_date(str(a.get("created_at")) if a.get("created_at") else None)
        status = a.get("status") or "applied"
        _, fg, _ = status_meta(status)
        sk = f"app_row_status_{aid}"
        if sk not in st.session_state:
            st.session_state[sk] = status if status in APPLICATION_STATUSES else "applied"

        if i > 0:
            st.markdown(
                '<div style="height:1px;background:var(--border);margin:0 20px;"></div>',
                unsafe_allow_html=True,
            )

        c1, c2, c3, c4 = st.columns([3.5, 1.0, 1.8, 0.5])
        with c1:
            st.markdown(
                f'<div style="display:flex;align-items:center;gap:14px;padding:8px 0 8px 4px;">'
                f'<div style="width:42px;height:42px;border-radius:12px;flex-shrink:0;'
                f'background:linear-gradient(135deg,{fg}12,{fg}06);'
                f'border:1px solid {fg}18;'
                f'display:flex;align-items:center;justify-content:center;'
                f'font-size:16px;font-weight:700;color:{fg};">{escape(co[:1].upper())}</div>'
                f'<div style="min-width:0;">'
                f'<div style="font-size:14px;font-weight:600;color:var(--text);'
                f'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{escape(co)}</div>'
                f'<div style="font-size:12px;color:var(--text-secondary);margin-top:1px;'
                f'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{escape(role)}</div></div></div>',
                unsafe_allow_html=True,
            )
        with c2:
            st.markdown(
                f'<div style="font-size:12px;color:var(--text-tertiary);padding-top:14px;">{escape(date_txt)}</div>',
                unsafe_allow_html=True,
            )
        with c3:
            st.selectbox(
                "Status",
                APPLICATION_STATUSES,
                key=sk,
                format_func=format_status_option,
                label_visibility="collapsed",
                on_change=_patch_app_status_streamlit,
                args=(backend_url, aid),
            )
        with c4:
            st.markdown('<div style="padding-top:4px;"></div>', unsafe_allow_html=True)
            if st.button("→", key=f"btn_app_view_{aid}"):
                st.session_state["selected_application_id"] = aid
                st.rerun()
        err = st.session_state.get(f"app_status_err_{aid}")
        if err:
            st.caption(f"Error: {err}")

    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(
        f'<p style="text-align:center;font-size:12px;color:var(--text-tertiary);padding:18px 0 4px;">'
        f'Showing {len(filtered)} of {len(applications)} applications</p>',
        unsafe_allow_html=True,
    )


def main() -> None:
    init_state()
    inject_styles()

    backend_url = st.session_state.backend_url.rstrip("/")
    app_url = st.session_state.app_url.rstrip("/")

    if not st.session_state.get("access_token"):
        render_login(backend_url, app_url)
        return

    ensure_session_id()

    if st.session_state.get("profile") is None:
        st.session_state["profile"] = fetch_profile(backend_url)

    profile = st.session_state.get("profile")
    if not profile:
        render_login(backend_url, app_url)
        return

    apps_resp = api_request(backend_url, "/me/applications")
    applications: list[dict[str, Any]] = apps_resp.json() if apps_resp.ok else []
    if not apps_resp.ok:
        st.warning(f"Could not load applications: {apps_resp.text}")

    # Layout: flush sidebar + full-width main
    nav_col, main_col = st.columns([1.0, 4.5])
    with nav_col:
        n_apps = len(applications)
        st.markdown(
            '<div class="nav-wrap">'
            '<div style="display:flex;align-items:center;gap:11px;margin-bottom:28px;">'
            '<div style="width:34px;height:34px;border-radius:10px;'
            'background:linear-gradient(135deg,#6366f1,#818cf8);'
            'display:flex;align-items:center;justify-content:center;'
            'box-shadow:0 2px 10px rgba(99,102,241,0.35);">'
            '<span style="font-size:16px;color:#fff;">⚡</span></div>'
            '<div style="font-size:17px;font-weight:800;color:#fff;letter-spacing:-0.02em;">JobAssist</div>'
            '</div></div>',
            unsafe_allow_html=True,
        )
        nav_main = st.session_state.main_nav
        if st.button("◻  Dashboard", use_container_width=True, type="primary" if nav_main == "dashboard" else "secondary"):
            st.session_state.main_nav = "dashboard"
            st.session_state.selected_application_id = None
            st.rerun()
        if st.button(
            f"📄  Applications  ({n_apps})",
            use_container_width=True,
            type="primary" if nav_main == "applications" else "secondary",
        ):
            st.session_state.main_nav = "applications"
            st.rerun()
        if st.button("👤  Profile", use_container_width=True, type="primary" if nav_main == "profile" else "secondary"):
            st.session_state.main_nav = "profile"
            st.session_state.selected_application_id = None
            st.rerun()
        if st.button("📑  Resumes", use_container_width=True, type="primary" if nav_main == "resume" else "secondary"):
            st.session_state.main_nav = "resume"
            st.session_state.selected_application_id = None
            st.rerun()
        if st.button("⚙  Settings", use_container_width=True, type="primary" if nav_main == "settings" else "secondary"):
            st.session_state.main_nav = "settings"
            st.session_state.selected_application_id = None
            st.rerun()

        # User block
        em = profile.get("email") or ""
        name = profile.get("full_name") or em.split("@")[0] or "User"
        initial = name[:1].upper()
        st.markdown(
            f'<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">'
            f'<div style="display:flex;align-items:center;gap:10px;padding:4px 0 8px;">'
            f'<div style="width:34px;height:34px;border-radius:10px;flex-shrink:0;'
            f'background:linear-gradient(135deg,#22c55e,#4ade80);'
            f'display:flex;align-items:center;justify-content:center;'
            f'font-size:14px;font-weight:700;color:#052e16;">{escape(initial)}</div>'
            f'<div style="min-width:0;flex:1;">'
            f'<div style="font-size:13px;font-weight:600;color:#fff;line-height:1.3;">{escape(name)}</div>'
            f'<div style="font-size:11px;color:rgba(255,255,255,0.3);overflow:hidden;'
            f'text-overflow:ellipsis;white-space:nowrap;">{escape(em)}</div></div></div></div>',
            unsafe_allow_html=True,
        )
        if st.button("Sign out", key="btn_sidebar_signout", use_container_width=True, type="secondary"):
            clear_auth_state()
            st.rerun()

    with main_col:
        # Invisible marker for CSS targeting
        st.markdown('<div class="main-content-marker" style="display:none;"></div>', unsafe_allow_html=True)

        page = st.session_state.main_nav
        if page == "dashboard":
            st.markdown(
                '<h1 style="font-size:30px;font-weight:800;margin:0 0 4px;'
                'letter-spacing:-0.03em;color:var(--text);">Dashboard</h1>'
                '<p style="font-size:14px;color:var(--text-secondary);margin:0 0 24px;font-weight:400;">'
                'Track your applications and manage your job search.</p>',
                unsafe_allow_html=True,
            )
            render_dashboard(applications)
        elif page == "applications":
            st.markdown(
                '<h1 style="font-size:30px;font-weight:800;margin:0 0 4px;'
                'letter-spacing:-0.03em;color:var(--text);">Applications</h1>',
                unsafe_allow_html=True,
            )
            render_applications_page(backend_url, applications)
        elif page == "profile":
            st.markdown(
                '<h1 style="font-size:30px;font-weight:800;margin:0 0 4px;'
                'letter-spacing:-0.03em;color:var(--text);">Profile</h1>'
                '<p style="font-size:14px;color:var(--text-secondary);margin:0 0 24px;font-weight:400;">'
                'Same fields as the first-time setup in the extension.</p>',
                unsafe_allow_html=True,
            )
            render_profile_form(backend_url, profile)
        elif page == "resume":
            st.markdown(
                '<h1 style="font-size:30px;font-weight:800;margin:0 0 4px;'
                'letter-spacing:-0.03em;color:var(--text);">Resumes</h1>'
                f'<p style="font-size:14px;color:var(--text-secondary);margin:0 0 24px;font-weight:400;">'
                f'Manage your uploaded resumes. Upload up to {MAX_RESUMES}.</p>',
                unsafe_allow_html=True,
            )
            render_resume_page(backend_url)
        elif page == "settings":
            st.markdown(
                '<h1 style="font-size:30px;font-weight:800;margin:0 0 4px;'
                'letter-spacing:-0.03em;color:var(--text);">Settings</h1>'
                '<p style="font-size:14px;color:var(--text-secondary);margin:0 0 24px;font-weight:400;">'
                'AI key and account settings.</p>',
                unsafe_allow_html=True,
            )
            render_settings_page(backend_url, profile)


if __name__ == "__main__":
    main()