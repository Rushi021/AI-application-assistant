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
            or k.startswith("app_sel_")
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
   LIGHT THEME — HirePath-style SaaS dashboard
   ══════════════════════════════════════════════════════════════ */

/* ── 0. Global background ── */
:root { color-scheme: light !important; }

.stApp,
.stApp > header,
.main .block-container,
section[data-testid="stMain"],
div[data-testid="stAppViewBlockContainer"],
.stMainBlockContainer,
.stApp [data-testid="stAppViewContainer"] {
    background-color: #F0F2F7 !important;
    color: #111827 !important;
}

/* ── 1. Kill Streamlit chrome ── */
header[data-testid="stHeader"],
.stApp > header,
[data-testid="stToolbar"] {
    background-color: #F0F2F7 !important;
    border: none !important;
}
[data-testid="stDecoration"], .stDeployButton { display: none !important; }
#MainMenu, footer { visibility: hidden !important; }

/* ── 2. Hide native sidebar (we use column-based nav) ── */
[data-testid="stSidebar"] { display: none !important; }

/* ── 3. Text inputs ── */
div[data-baseweb="input"] {
    background-color: #ffffff !important;
    border: 1px solid #E5E7EB !important;
    border-radius: 10px !important;
    box-shadow: none !important;
    transition: border-color 0.2s ease !important;
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
    color: #111827 !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    caret-color: #4F6BED !important;
    font-size: 14px !important;
}
div[data-baseweb="input"]:hover { border-color: #D1D5DB !important; }
div[data-baseweb="input"]:focus-within {
    border-color: #4F6BED !important;
    box-shadow: 0 0 0 3px rgba(79,107,237,0.1) !important;
}
div[data-baseweb="input"] input::placeholder { color: #9CA3AF !important; }

/* ── 4. Textarea ── */
div[data-baseweb="textarea"],
[data-testid="stTextArea"] textarea {
    background-color: #ffffff !important;
    color: #111827 !important;
    border: 1px solid #E5E7EB !important;
    border-radius: 10px !important;
    box-shadow: none !important;
}
div[data-baseweb="textarea"]:hover { border-color: #D1D5DB !important; }
div[data-baseweb="textarea"]:focus-within,
[data-testid="stTextArea"] textarea:focus {
    border-color: #4F6BED !important;
    box-shadow: 0 0 0 3px rgba(79,107,237,0.1) !important;
}

/* ── 5. Select / Dropdown ── */
[data-testid="stSelectbox"] [data-baseweb="select"] > div,
div[data-baseweb="select"] > div {
    background-color: #ffffff !important;
    border: 1px solid #E5E7EB !important;
    border-radius: 10px !important;
    box-shadow: none !important;
    color: #111827 !important;
}
[data-testid="stSelectbox"] [data-baseweb="select"] > div:hover { border-color: #D1D5DB !important; }
[data-testid="stSelectbox"] [data-baseweb="select"] > div:focus-within {
    border-color: #4F6BED !important;
    box-shadow: 0 0 0 3px rgba(79,107,237,0.1) !important;
}
[data-testid="stSelectbox"] [data-baseweb="select"] span,
div[data-baseweb="select"] span,
.stSelectbox div[role="combobox"] * { color: #111827 !important; }
[data-testid="stSelectbox"] svg, div[data-baseweb="select"] svg { fill: #9CA3AF !important; }
/* Dropdown menu */
[data-baseweb="popover"], [data-baseweb="popover"] > div,
ul[role="listbox"], div[data-baseweb="menu"] {
    background-color: #ffffff !important;
    border: 1px solid #E5E7EB !important;
    border-radius: 10px !important;
    box-shadow: 0 8px 24px rgba(0,0,0,0.08) !important;
}
ul[role="listbox"] li { color: #374151 !important; background: transparent !important; }
ul[role="listbox"] li:hover { background-color: #F3F4F6 !important; color: #111827 !important; }
ul[role="listbox"] li[aria-selected="true"] { background-color: rgba(79,107,237,0.08) !important; color: #4F6BED !important; }

/* ── 6. Labels ── */
.stMarkdown, .stText, label,
[data-testid="stWidgetLabel"] label,
[data-testid="stWidgetLabel"] p { color: #6B7280 !important; font-size: 13px !important; }
.stMarkdown b, .stMarkdown strong { color: #374151 !important; }

/* ── 7. Expanders ── */
[data-testid="stExpander"] details {
    background: #ffffff !important;
    border: 1px solid #E5E7EB !important;
    border-radius: 12px !important;
    overflow: hidden !important;
}
[data-testid="stExpander"] summary {
    font-weight: 600 !important; font-size: 14px !important;
    color: #111827 !important; padding: 14px 16px !important;
    background: transparent !important;
}
[data-testid="stExpander"] summary:hover { background: #F9FAFB !important; }
[data-testid="stExpander"] summary:focus,
[data-testid="stExpander"] summary:focus-visible,
[data-testid="stExpander"] details[open] > summary {
    background: transparent !important; color: #111827 !important;
    outline: none !important; box-shadow: none !important;
}
[data-testid="stExpander"] details > div { border-top: 1px solid #F3F4F6 !important; }

/* ── 8. Bordered containers ── */
div[data-testid="stVerticalBlockBorderWrapper"] {
    border: 1px solid #E5E7EB !important;
    border-radius: 10px !important;
    background: #FAFBFC !important;
}

/* ── 9. Buttons ── */
/* Primary (accent blue) */
button[kind="primary"],
div[data-testid="stFormSubmitButton"] button {
    background: #4F6BED !important;
    color: #fff !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 600 !important;
    box-shadow: 0 2px 8px rgba(79,107,237,0.2) !important;
}
button[kind="primary"]:hover { box-shadow: 0 4px 14px rgba(79,107,237,0.3) !important; }
/* Secondary */
button[kind="secondary"], .stButton > button {
    background: transparent !important;
    color: #6B7280 !important;
    border: 1px solid #E5E7EB !important;
    border-radius: 10px !important;
}
button[kind="secondary"]:hover, .stButton > button:hover {
    border-color: #4F6BED !important;
    color: #4F6BED !important;
    background: rgba(79,107,237,0.04) !important;
}
/* Link button (login) */
.stLinkButton > a, div[data-testid="stLinkButton"] > a {
    background: #4F6BED !important; color: #fff !important;
    border: none !important; border-radius: 10px !important;
    font-weight: 600 !important; text-decoration: none !important;
    box-shadow: 0 2px 8px rgba(79,107,237,0.2) !important;
}

/* ── 10. Tabs ── */
.stTabs [data-baseweb="tab-list"] { gap:0 !important; border-bottom: 1px solid #E5E7EB !important; background: transparent !important; }
.stTabs [data-baseweb="tab"] { color: #9CA3AF !important; font-weight: 500 !important; background: transparent !important; border: none !important; }
.stTabs [data-baseweb="tab"]:hover { color: #6B7280 !important; background: #F9FAFB !important; }
.stTabs [aria-selected="true"] { color: #4F6BED !important; font-weight: 700 !important; border-bottom: 2px solid #4F6BED !important; }
.stTabs [data-baseweb="tab-highlight"] { background-color: #4F6BED !important; }
.stTabs [data-baseweb="tab-border"] { display: none !important; }

/* ── 11. Checkboxes ── */
.stCheckbox label, .stCheckbox label span { color: #374151 !important; }

/* ── 12. File uploader ── */
[data-testid="stFileUploader"], [data-testid="stFileUploader"] > div,
[data-testid="stFileUploader"] section { background: transparent !important; border: none !important; color: #6B7280 !important; }
[data-testid="stFileUploader"] button { background: #fff !important; border: 1px solid #E5E7EB !important; color: #374151 !important; border-radius: 10px !important; }

/* ── 13. Form container ── */
[data-testid="stForm"], [data-testid="stForm"] > div {
    background: #ffffff !important; border: 1px solid #E5E7EB !important; border-radius: 14px !important;
}

/* ── 14. Alerts ── */
[data-testid="stAlert"] > div { border-radius: 10px !important; }

/* ── 15. Typography ── */
h1, h2, h3, h4, h5, h6 { color: #111827 !important; }
h5 { font-size: 13px !important; }
a { color: #4F6BED !important; }

/* ── 16. Spacing ── */
div[data-testid="stVerticalBlock"] > div { gap: 0.35rem !important; }

/* ── 17. Scrollbar ── */
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }

/* ── 18. EEO rows ── */
.eeo-q { font-size: 13px; color: #6B7280; margin: 0; padding: 10px 0 6px; line-height: 1.4; }
.eeo-row-hr { border: none; border-top: 1px solid #F3F4F6; margin: 0 0 4px; }

/* ══════════════════════════════════════════════════════════════
   NAV COLUMN — dark sidebar inside st.columns
   ══════════════════════════════════════════════════════════════ */
.nav-wrap {
    background: #141332 !important;
    border: none !important;
    border-radius: 14px;
    padding: 14px;
    margin-bottom: 8px;
}
.nav-title { font-size: 9px; letter-spacing: 0.1em; color: rgba(255,255,255,0.3); font-weight: 700; }

/* Force buttons inside nav column to look like dark nav items */
.nav-wrap ~ div button,
div[data-testid="stVerticalBlock"] .nav-wrap ~ div button {
    background: transparent !important;
    color: rgba(255,255,255,0.5) !important;
    border: none !important;
    text-align: left !important;
    font-weight: 500 !important;
    border-radius: 10px !important;
    padding: 10px 14px !important;
}
.nav-wrap ~ div button:hover {
    background: rgba(255,255,255,0.06) !important;
    color: rgba(255,255,255,0.8) !important;
    border: none !important;
}
.nav-wrap ~ div button[kind="primary"] {
    background: #4F6BED !important;
    color: #fff !important;
    font-weight: 600 !important;
    border: none !important;
}

/* Target the first column (nav) specifically */
div[data-testid="stHorizontalBlock"] > div:first-child {
    background: #141332 !important;
    border-radius: 14px !important;
    padding: 8px !important;
    min-height: 80vh !important;
}
div[data-testid="stHorizontalBlock"] > div:first-child * {
    color: rgba(255,255,255,0.5) !important;
}
div[data-testid="stHorizontalBlock"] > div:first-child h1,
div[data-testid="stHorizontalBlock"] > div:first-child h2,
div[data-testid="stHorizontalBlock"] > div:first-child h3,
div[data-testid="stHorizontalBlock"] > div:first-child b,
div[data-testid="stHorizontalBlock"] > div:first-child strong {
    color: #ffffff !important;
}
div[data-testid="stHorizontalBlock"] > div:first-child button {
    background: transparent !important;
    color: rgba(255,255,255,0.5) !important;
    border: none !important;
    border-radius: 10px !important;
}
div[data-testid="stHorizontalBlock"] > div:first-child button:hover {
    background: rgba(255,255,255,0.06) !important;
    color: #fff !important;
}
div[data-testid="stHorizontalBlock"] > div:first-child button[kind="primary"] {
    background: #4F6BED !important;
    color: #fff !important;
}

/* ── Custom classes used in st.markdown ── */
.logo-pill {
    width: 32px; height: 32px; border-radius: 10px;
    background: linear-gradient(135deg, #4F6BED, #7C3AED);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0; color: #fff;
}
.muted { color: #6B7280 !important; font-size: 13px; }
.dim { color: #9CA3AF !important; font-size: 11px; }

/* ══════════════════════════════════════════════════════════════
   STAT CARDS — white cards with colored bottom bar
   ══════════════════════════════════════════════════════════════ */
.stat-card {
    background: #ffffff;
    border: 1px solid rgba(0,0,0,0.06);
    border-radius: 16px;
    padding: 18px 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    position: relative;
    overflow: hidden;
}
.stat-card .bar {
    position: absolute; bottom: 0; left: 12px; right: 12px;
    height: 3px; border-radius: 2px; opacity: 0.5;
}
.stat-card .num { font-size: 36px; font-weight: 900; line-height: 1; color: #111827; }
.stat-card .lbl { font-size: 12px; color: #6B7280; font-weight: 500; margin-top: 6px; }

/* ══════════════════════════════════════════════════════════════
   APPLICATION ROW
   ══════════════════════════════════════════════════════════════ */
.app-row {
    background: #ffffff;
    border: 1px solid rgba(0,0,0,0.06);
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 8px;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.app-row:hover {
    border-color: rgba(0,0,0,0.1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
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
        "applied": ("Applied", "#4F6BED", "rgba(79,107,237,0.10)"),
        "assessment": ("Assessment", "#6366F1", "rgba(99,102,241,0.10)"),
        "interview_round_1": ("Interview R1", "#8B5CF6", "rgba(139,92,246,0.10)"),
        "interview_round_2": ("Interview R2", "#8B5CF6", "rgba(139,92,246,0.10)"),
        "interview_round_3": ("Interview R3", "#8B5CF6", "rgba(139,92,246,0.10)"),
        "offer": ("Offer", "#10B981", "rgba(16,185,129,0.10)"),
        "rejected": ("Rejected", "#EF4444", "rgba(239,68,68,0.10)"),
        "withdrawn": ("Withdrawn", "#9CA3AF", "rgba(156,163,175,0.15)"),
    }
    return mapping.get(key, ("Pending", "#F59E0B", "rgba(245,158,11,0.12)"))


def status_badge_html(status: str | None) -> str:
    label, fg, bg = status_meta(status)
    return (
        f'<span style="font-size:11px;font-weight:600;color:{fg};'
        f'background:{bg};padding:4px 10px;border-radius:8px;">{escape(label)}</span>'
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


def _make_app_status_callback(backend_url: str, application_id: int):
    def _cb() -> None:
        key = f"app_sel_{application_id}"
        new = st.session_state.get(key)
        if not new or new not in APPLICATION_STATUSES:
            return
        prev = st.session_state.get(f"app_srv_{application_id}", new)
        r = api_request(
            backend_url,
            f"/me/applications/{application_id}/status",
            method="PATCH",
            json_body={"status": new},
        )
        if r.ok:
            st.session_state.pop(f"app_status_err_{application_id}", None)
            st.rerun()
        else:
            st.session_state[key] = prev
            st.session_state[f"app_status_err_{application_id}"] = r.text or "Update failed"
            st.rerun()

    return _cb


def compute_stats(apps: list[dict[str, Any]]) -> dict[str, int]:
    total = len(apps)
    n_interview = sum(
        1
        for a in apps
        if "interview" in (a.get("status") or "")
    )
    n_offer = sum(1 for a in apps if (a.get("status") or "") == "offer")
    n_pending = sum(
        1 for a in apps if (a.get("status") or "") in ("applied", "assessment")
    )
    return {"total": total, "interview": n_interview, "offered": n_offer, "pending": n_pending}


def render_login(backend_url: str, app_url: str) -> None:
    st.title("AI Job Application Assistant")
    st.caption("Sign in with Google. Access is controlled by the admin whitelist.")

    query_params = st.query_params
    login_code = query_params.get("code")
    if login_code:
        with st.spinner("Completing sign-in..."):
            if exchange_web_login_code(backend_url, login_code):
                st.success("Signed in successfully.")
                st.rerun()

    login_url = f"{backend_url}/auth/web/google/start?next={quote_plus(app_url)}"
    st.link_button("Sign in with Google", login_url, type="primary")
    st.info(
        "If access is denied, your email is not active in the whitelist yet. "
        "Submit your email through the shared Google Form and wait for activation."
    )


def render_profile_form(backend_url: str, profile: dict[str, Any]) -> None:
    hydrate_profile_widgets(profile)
    pid = profile["id"]
    prefix = f"pf_{pid}_"
    email = profile.get("email") or ""

    st.markdown(
        f'<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">'
        f'<div class="logo-pill" style="width:52px;height:52px;border-radius:50%;font-size:20px;">'
        f'{escape((profile.get("full_name") or email or "?")[:1].upper())}</div>'
        f'<div><div style="font-size:18px;font-weight:700;">{escape(profile.get("full_name") or "Your name")}</div>'
        f'<div class="muted">{escape(email)}</div></div></div>',
        unsafe_allow_html=True,
    )

    with st.expander("Basic info", expanded=True):
        st.text_input("Full name", key=f"{prefix}full_name")
        st.markdown(
            f'<p class="muted" style="margin:0 0 8px;"><b>Email</b> (from Google): {escape(email)}</p>',
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
        st.caption("No resumes yet.")

    for item in resumes:
        rid = int(item["id"])
        c1, c2 = st.columns([5, 1])
        with c1:
            cs = " · Client-stored" if item.get("client_stored") else ""
            st.markdown(
                f'<div style="display:flex;align-items:center;gap:12px;background:#0f0f12;border:1px solid #1c1c22;'
                f'border-radius:12px;padding:14px 18px;margin-bottom:8px;">'
                f'<div style="width:36px;height:36px;border-radius:9px;background:rgba(34,197,94,0.08);'
                f'border:1px solid rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center;">📄</div>'
                f'<div><div style="font-size:13px;font-weight:600;">{escape(item.get("original_filename") or "Resume")}</div>'
                f'<div class="dim" style="font-size:11px;">{item.get("size_bytes", 0) // 1024} KB · id {rid}{escape(cs)}</div></div></div>',
                unsafe_allow_html=True,
            )
        with c2:
            if st.button("Delete", key=f"del_resume_{rid}", type="secondary"):
                with st.spinner("Removing…"):
                    d = api_delete_resume(backend_url, rid)
                if d.status_code == 204:
                    st.rerun()
                else:
                    st.error(f"Delete failed: {d.text}")

    if len(resumes) < MAX_RESUMES:
        st.markdown(
            '<div style="border:1px dashed #27272a;border-radius:12px;padding:32px 20px;text-align:center;margin-top:12px;">'
            '<div style="font-size:22px;margin-bottom:8px;">⬆</div>'
            '<p class="muted" style="margin:0;">Drop a resume here or use the file picker below.</p>'
            '<p class="dim" style="margin:6px 0 0 0;font-size:10px;">.docx, .doc, or .pdf</p></div>',
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
            # Auto-upload once immediately after file selection.
            token = f"{getattr(up, 'file_id', '')}:{up.name}:{getattr(up, 'size', 0)}"
            if st.session_state.get("resume_last_upload_token") != token:
                st.session_state["resume_last_upload_token"] = token
                data = up.getvalue()
                with st.spinner("Uploading…"):
                    resp = api_upload_resume(backend_url, data, up.name)
                if resp.ok:
                    # Rotate uploader key to clear the selected file chip and avoid repeated uploads.
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


def render_settings_page(backend_url: str, app_url: str) -> None:
    st.markdown(
        '<p style="font-size:14px;font-weight:700;margin:0 0 14px 0;">Connection</p>',
        unsafe_allow_html=True,
    )
    c1, c2 = st.columns(2)
    with c1:
        st.text_input("Backend URL", key="backend_url")
    with c2:
        st.text_input("App URL (OAuth redirect)", key="app_url")
    try:
        health = requests.get(f"{backend_url}/health", timeout=5)
        if health.ok:
            st.markdown(
                '<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);'
                'border-radius:8px;padding:8px 12px;font-size:12px;color:#22c55e;font-weight:600;display:inline-flex;'
                'align-items:center;gap:6px;"><span style="width:6px;height:6px;border-radius:50%;'
                'background:#22c55e;"></span>Backend reachable</div>',
                unsafe_allow_html=True,
            )
        else:
            st.error("Backend unhealthy")
    except requests.RequestException:
        st.error("Backend unreachable")

    st.markdown(
        '<p style="font-size:14px;font-weight:700;margin:24px 0 6px 0;">Account</p>'
        '<p class="dim" style="margin:0 0 14px 0;font-size:12px;">Sign out of your current session.</p>',
        unsafe_allow_html=True,
    )
    if st.button("Sign out", type="secondary"):
        clear_auth_state()
        st.rerun()


def render_dashboard(applications: list[dict[str, Any]]) -> None:
    stats = compute_stats(applications)
    stat_cards = [
        ("Total Applied", stats["total"], "#4F6BED"),
        ("Interviews", stats["interview"], "#8B5CF6"),
        ("Offers", stats["offered"], "#10B981"),
        ("Pending", stats["pending"], "#F59E0B"),
    ]
    stat_icons = {
        "Total Applied": ("📋", "#4F6BED"),
        "Interviews": ("👥", "#8B5CF6"),
        "Offers": ("✓", "#10B981"),
        "Pending": ("⏱", "#F59E0B"),
    }
    cards_html = ""
    for label, v, color in stat_cards:
        icon, _ = stat_icons.get(label, ("•", color))
        cards_html += (
            f'<div class="stat-card">'
            f'<div class="num">{v:02d}</div>'
            f'<div class="lbl">{escape(label)}</div>'
            f'<div class="bar" style="background:{color};"></div>'
            f'</div>'
        )
    st.markdown(
        f'<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px;">{cards_html}</div>',
        unsafe_allow_html=True,
    )

    left_col, right_col = st.columns([2.0, 1.0])
    with left_col:
        card_top_left, card_top_right = st.columns([3, 1])
        with card_top_left:
            st.markdown('<p style="font-size:14px;font-weight:700;margin:4px 0 10px;">Recent Applications</p>', unsafe_allow_html=True)
        with card_top_right:
            if st.button("View All →", key="btn_view_all_apps"):
                st.session_state.main_nav = "applications"
                st.rerun()
        recent = sorted(applications, key=lambda a: parse_created_date(a.get("created_at")) or datetime.min, reverse=True)[:5]
        if not recent:
            st.info("No recent applications yet.")
        for a in recent:
            aid = int(a["id"])
            co = (a.get("company_name") or "Company").strip() or "Company"
            role = (a.get("role_title") or "").strip() or "Role"
            date_txt = fmt_app_date(str(a.get("created_at")) if a.get("created_at") else None)
            c1, c2, c3 = st.columns([6, 2, 1])
            with c1:
                st.markdown(
                    f'<div style="display:flex;align-items:center;gap:12px;">'
                    f'<div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#4F6BED,#7C3AED);'
                    f'display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;">{escape(co[:1].upper())}</div>'
                    f'<div><div style="font-size:13px;font-weight:600;color:#111827;">{escape(co)}</div>'
                    f'<div style="font-size:12px;color:#6B7280;">{escape(role)}</div></div></div>',
                    unsafe_allow_html=True,
                )
            with c2:
                st.markdown(
                    f'<div style="text-align:right;"><div style="font-size:11px;color:#6B7280;">{escape(date_txt)}</div>'
                    f'<div style="margin-top:3px;">{status_badge_html(a.get("status"))}</div></div>',
                    unsafe_allow_html=True,
                )
            with c3:
                if st.button("View", key=f"btn_recent_view_{aid}"):
                    st.session_state.selected_application_id = aid
                    st.session_state.main_nav = "applications"
                    st.rerun()

    with right_col:
        st.markdown('<p style="font-size:14px;font-weight:700;margin:4px 0 8px;">Pipeline</p>', unsafe_allow_html=True)
        d1, d3, d7 = st.columns(3)
        for n, col in ((1, d1), (3, d3), (7, d7)):
            with col:
                active = st.session_state.pipeline_days == n
                if st.button(f"{n}d", key=f"btn_pipeline_{n}", use_container_width=True, type="primary" if active else "secondary"):
                    st.session_state.pipeline_days = n
                    st.rerun()
        now = datetime.utcnow()
        filtered = [
            a for a in applications
            if (parse_created_date(a.get("created_at")) or datetime.min) >= (now.replace(tzinfo=None) - timedelta(days=st.session_state.pipeline_days))
        ]
        rows = [
            ("Applied", sum(1 for a in filtered if (a.get("status") or "") == "applied"), "#4F6BED"),
            ("Assessment", sum(1 for a in filtered if (a.get("status") or "") == "assessment"), "#6366F1"),
            ("Interview", sum(1 for a in filtered if "interview" in (a.get("status") or "")), "#8B5CF6"),
            ("Offer", sum(1 for a in filtered if (a.get("status") or "") == "offer"), "#10B981"),
            ("Rejected", sum(1 for a in filtered if (a.get("status") or "") == "rejected"), "#EF4444"),
        ]
        max_n = max((n for _, n, _ in rows), default=1) or 1
        for label, n, c in rows:
            pct = int((n / max_n) * 100) if (max_n and n > 0) else 0
            st.markdown(
                f'<div style="margin-bottom:8px;">'
                f'<div style="display:flex;justify-content:space-between;font-size:11px;color:#6B7280;">'
                f'<span>{label}</span><span style="color:{c};font-weight:700;">{n}</span></div>'
                f'<div style="height:5px;border-radius:3px;background:#F1F5F9;margin-top:4px;">'
                f'<div style="height:100%;width:{pct}%;background:{c};border-radius:3px;"></div></div></div>',
                unsafe_allow_html=True,
            )

        st.markdown('<p style="font-size:14px;font-weight:700;margin:14px 0 8px;">Activity</p>', unsafe_allow_html=True)
        act = sorted(applications, key=lambda a: parse_created_date(a.get("created_at")) or datetime.min, reverse=True)[:5]
        if not act:
            st.caption("No activity yet.")
        for a in act:
            label, color, _ = status_meta(a.get("status"))
            co = (a.get("company_name") or "Company").strip() or "Company"
            st.markdown(
                f'<div style="display:flex;gap:8px;margin-bottom:8px;">'
                f'<div style="width:6px;height:6px;border-radius:50%;background:{color};margin-top:5px;"></div>'
                f'<div><div style="font-size:11px;color:#111827;">{escape(label)} — {escape(co)}</div>'
                f'<div style="font-size:10px;color:#9CA3AF;">{escape(fmt_app_date(str(a.get("created_at")) if a.get("created_at") else None))}</div></div></div>',
                unsafe_allow_html=True,
            )


def render_applications_page(backend_url: str, applications: list[dict[str, Any]]) -> None:
    st.text_input("Search applications", key="apps_search", placeholder="Search...", label_visibility="collapsed")
    options = ["all"] + APPLICATION_STATUSES
    if st.session_state.apps_filter not in options:
        st.session_state.apps_filter = "all"
    st.selectbox(
        "Filter",
        options=options,
        key="apps_filter",
        format_func=lambda x: "All" if x == "all" else format_status_option(x),
        label_visibility="collapsed",
    )
    q = (st.session_state.apps_search or "").lower().strip()
    f = st.session_state.apps_filter
    filtered = [
        a for a in applications
        if (f == "all" or (a.get("status") or "") == f)
        and (not q or q in (a.get("company_name") or "").lower() or q in (a.get("role_title") or "").lower())
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
        st.markdown(
            f'<div style="background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:16px;padding:18px;">'
            f'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">'
            f'<div><div style="font-size:22px;font-weight:800;color:#111827;">{escape(co)}</div>'
            f'<div style="font-size:13px;color:#6B7280;">{escape(role)}</div></div>'
            f'<div>{status_badge_html(status)}</div></div>'
            f'<div style="margin-top:10px;font-size:12px;color:#6B7280;">Portal: {escape(host)} · Applied: {escape(fmt_app_date(str(app.get("created_at")) if app.get("created_at") else None))}</div>'
            '</div>',
            unsafe_allow_html=True,
        )
        key = f"detail_status_{selected}"
        st.selectbox("Update status", APPLICATION_STATUSES, key=key, index=APPLICATION_STATUSES.index(status) if status in APPLICATION_STATUSES else 0)
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
        st.info("No results")
        return
    for a in filtered:
        aid = int(a["id"])
        co = (a.get("company_name") or "Company").strip() or "Company"
        role = (a.get("role_title") or "").strip() or "Role"
        date_txt = fmt_app_date(str(a.get("created_at")) if a.get("created_at") else None)
        r1, r2, r3 = st.columns([5, 2, 1])
        with r1:
            st.markdown(
                f'<div style="display:flex;align-items:center;gap:12px;padding:4px 0;">'
                f'<div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#4F6BED,#7C3AED);'
                f'display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;">{escape(co[:1].upper())}</div>'
                f'<div><div style="font-size:13px;font-weight:600;color:#111827;">{escape(co)}</div>'
                f'<div style="font-size:12px;color:#6B7280;">{escape(role)}</div></div></div>',
                unsafe_allow_html=True,
            )
        with r2:
            st.markdown(f'<div style="text-align:right;font-size:11px;color:#6B7280;">{escape(date_txt)}<br>{status_badge_html(a.get("status"))}</div>', unsafe_allow_html=True)
        with r3:
            if st.button("View", key=f"btn_app_view_{aid}"):
                st.session_state["selected_application_id"] = aid
                st.rerun()


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

    # Layout: left nav + main content
    nav_col, main_col = st.columns([1.05, 3.95])
    with nav_col:
        st.markdown(
            '<div class="nav-wrap" style="background:#141332;border:0;padding:14px;">'
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
            '<div class="logo-pill" style="width:30px;height:30px;border-radius:8px;background:#4F6BED;">⚡</div>'
            '<div><div style="font-size:14px;font-weight:800;color:#fff;">JobAssist</div></div>'
            "</div>"
            '<div class="nav-title" style="display:none;">NAVIGATION</div>',
            unsafe_allow_html=True,
        )
        nav_main = st.session_state.main_nav
        if st.button("Dashboard", use_container_width=True, type="primary" if nav_main == "dashboard" else "secondary"):
            st.session_state.main_nav = "dashboard"
            st.session_state.selected_application_id = None
            st.rerun()
        if st.button("Applications", use_container_width=True, type="primary" if nav_main == "applications" else "secondary"):
            st.session_state.main_nav = "applications"
            st.rerun()
        if st.button("Profile", use_container_width=True, type="primary" if nav_main == "profile" else "secondary"):
            st.session_state.main_nav = "profile"
            st.session_state.selected_application_id = None
            st.rerun()
        if st.button("Resumes", use_container_width=True, type="primary" if nav_main == "resume" else "secondary"):
            st.session_state.main_nav = "resume"
            st.session_state.selected_application_id = None
            st.rerun()
        if st.button("Settings", use_container_width=True, type="primary" if nav_main == "settings" else "secondary"):
            st.session_state.main_nav = "settings"
            st.session_state.selected_application_id = None
            st.rerun()
        em = profile.get("email") or ""
        name = profile.get("full_name") or em.split("@")[0] or "User"
        initial = name[:1].upper()
        st.markdown(
            '<div style="margin-top:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);"></div>'
            f'<div style="display:flex;align-items:center;gap:9px;padding:8px 0;">'
            f'<div class="logo-pill" style="width:30px;height:30px;border-radius:50%;font-size:11px;">{escape(initial)}</div>'
            f'<div style="min-width:0;"><div style="font-size:12px;font-weight:700;color:#fff;">{escape(name)}</div>'
            f'<div style="font-size:10px;color:rgba(255,255,255,0.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{escape(em)}</div></div></div>',
            unsafe_allow_html=True,
        )
        if st.button("Sign out", key="btn_sidebar_signout", use_container_width=True, type="secondary"):
            clear_auth_state()
            st.rerun()

    with main_col:
        page = st.session_state.main_nav
        if page == "dashboard":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Dashboard</h1>"
                "<p style='font-size:13px;color:#6B7280;margin:0 0 14px;'>Track your applications and manage your job search.</p>",
                unsafe_allow_html=True,
            )
            render_dashboard(applications)
        elif page == "applications":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 10px;'>Applications</h1>",
                unsafe_allow_html=True,
            )
            render_applications_page(backend_url, applications)
        elif page == "profile":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Profile</h1>"
                "<p style='font-size:13px;color:#6B7280;margin:0 0 14px;'>Same fields as the first-time setup in the extension.</p>",
                unsafe_allow_html=True,
            )
            render_profile_form(backend_url, profile)
        elif page == "resume":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Resumes</h1>"
                f"<p style='font-size:13px;color:#6B7280;margin:0 0 14px;'>Manage your uploaded resumes. Upload up to {MAX_RESUMES}.</p>",
                unsafe_allow_html=True,
            )
            render_resume_page(backend_url)
        elif page == "settings":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Settings</h1>"
                "<p style='font-size:13px;color:#6B7280;margin:0 0 14px;'>Connection and account settings.</p>",
                unsafe_allow_html=True,
            )
            render_settings_page(backend_url, app_url)


if __name__ == "__main__":
    main()
