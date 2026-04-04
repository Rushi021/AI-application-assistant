"""
Streamlit user app: dashboard UI aligned with the extension onboarding profile,
wired to the same FastAPI backend as the Chrome extension.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
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
    st.session_state.setdefault("apps_search", "")
    st.session_state.setdefault("apps_filter", "all")
    st.session_state.setdefault("resume_uploader_nonce", 0)
    st.session_state.setdefault("backend_url", os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/"))
    st.session_state.setdefault("app_url", os.environ.get("STREAMLIT_APP_URL", "http://localhost:8501").rstrip("/"))


def clear_auth_state() -> None:
    st.session_state["access_token"] = None
    st.session_state["refresh_token"] = None
    st.session_state["profile"] = None
    st.session_state.pop("session_id", None)
    st.session_state.pop("resume_uploader_nonce", None)
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
   0. ROOT + GLOBAL DARK MODE
   ══════════════════════════════════════════════════════════════ */
:root { color-scheme: dark !important; }

.stApp,
.stApp > header,
.main .block-container,
section[data-testid="stMain"],
div[data-testid="stAppViewBlockContainer"],
.stMainBlockContainer,
.stApp [data-testid="stAppViewContainer"] {
    background-color: #09090b !important;
    color: #fafafa !important;
}

/* ══════════════════════════════════════════════════════════════
   1. KILL WHITE TOP BAR + STREAMLIT CHROME
   ══════════════════════════════════════════════════════════════ */
header[data-testid="stHeader"],
.stApp > header,
[data-testid="stToolbar"] {
    background-color: #09090b !important;
    border-bottom: none !important;
}
[data-testid="stDecoration"],
.stDeployButton {
    display: none !important;
}
#MainMenu, footer { visibility: hidden !important; }

/* ══════════════════════════════════════════════════════════════
   2. TEXT INPUTS — ultra-aggressive selectors
   Every layer of BaseWeb's input wrapper must be hit.
   ══════════════════════════════════════════════════════════════ */

/* Outer wrapper */
div[data-baseweb="input"] {
    background-color: #111114 !important;
    border: 1px solid rgba(255,255,255,0.06) !important;
    border-radius: 10px !important;
    box-shadow: none !important;
    transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
}
/* Inner div that BaseWeb nests */
div[data-baseweb="input"] > div {
    background-color: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
/* The actual <input> element */
div[data-baseweb="input"] input,
[data-testid="stTextInput"] input,
[data-testid="stNumberInput"] input {
    background-color: transparent !important;
    color: #e4e4e7 !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    caret-color: #22c55e !important;
    font-size: 14px !important;
}
/* Hover state — subtle border lift */
div[data-baseweb="input"]:hover {
    border-color: rgba(255,255,255,0.12) !important;
}
/* Focus state — green glow */
div[data-baseweb="input"]:focus-within {
    border-color: rgba(34,197,94,0.5) !important;
    box-shadow: 0 0 0 3px rgba(34,197,94,0.08) !important;
}
/* Placeholder */
div[data-baseweb="input"] input::placeholder {
    color: #3f3f46 !important;
}
/* Autofill override */
input:-webkit-autofill,
input:-webkit-autofill:focus {
    -webkit-box-shadow: 0 0 0 30px #111114 inset !important;
    -webkit-text-fill-color: #e4e4e7 !important;
    transition: background-color 5000s ease-in-out 0s !important;
}

/* ══════════════════════════════════════════════════════════════
   3. TEXTAREA
   ══════════════════════════════════════════════════════════════ */
div[data-baseweb="textarea"],
[data-testid="stTextArea"] textarea {
    background-color: #111114 !important;
    color: #e4e4e7 !important;
    border: 1px solid rgba(255,255,255,0.06) !important;
    border-radius: 10px !important;
    box-shadow: none !important;
    outline: none !important;
    caret-color: #22c55e !important;
}
div[data-baseweb="textarea"]:hover,
[data-testid="stTextArea"] textarea:hover {
    border-color: rgba(255,255,255,0.12) !important;
}
div[data-baseweb="textarea"]:focus-within,
[data-testid="stTextArea"] textarea:focus {
    border-color: rgba(34,197,94,0.5) !important;
    box-shadow: 0 0 0 3px rgba(34,197,94,0.08) !important;
}

/* ══════════════════════════════════════════════════════════════
   4. SELECT / DROPDOWN
   ══════════════════════════════════════════════════════════════ */
[data-testid="stSelectbox"] [data-baseweb="select"] > div,
div[data-baseweb="select"] > div {
    background-color: #111114 !important;
    border: 1px solid rgba(255,255,255,0.06) !important;
    border-radius: 10px !important;
    box-shadow: none !important;
    min-height: 2.5rem !important;
    color: #e4e4e7 !important;
    transition: border-color 0.2s ease !important;
}
[data-testid="stSelectbox"] [data-baseweb="select"] > div:hover,
div[data-baseweb="select"] > div:hover {
    border-color: rgba(255,255,255,0.12) !important;
}
[data-testid="stSelectbox"] [data-baseweb="select"] > div:focus-within,
div[data-baseweb="select"] > div:focus-within {
    border-color: rgba(34,197,94,0.5) !important;
    box-shadow: 0 0 0 3px rgba(34,197,94,0.08) !important;
}
/* Text color inside select */
[data-testid="stSelectbox"] [data-baseweb="select"] span,
div[data-baseweb="select"] span,
.stSelectbox div[role="combobox"],
.stSelectbox div[role="combobox"] * {
    color: #e4e4e7 !important;
}
/* Arrow icon */
[data-testid="stSelectbox"] svg,
div[data-baseweb="select"] svg {
    fill: #3f3f46 !important;
}
/* Dropdown popover menu */
[data-baseweb="popover"],
[data-baseweb="popover"] > div,
ul[role="listbox"],
div[data-baseweb="menu"] {
    background-color: #111114 !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 10px !important;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5) !important;
}
ul[role="listbox"] li {
    color: #a1a1aa !important;
    background: transparent !important;
}
ul[role="listbox"] li:hover {
    background-color: rgba(255,255,255,0.04) !important;
    color: #e4e4e7 !important;
}
ul[role="listbox"] li[aria-selected="true"] {
    background-color: rgba(34,197,94,0.1) !important;
    color: #22c55e !important;
}

/* ══════════════════════════════════════════════════════════════
   5. INPUT LABELS — softer, not bright white
   ══════════════════════════════════════════════════════════════ */
.stMarkdown, .stText, label,
[data-testid="stWidgetLabel"] label,
[data-testid="stWidgetLabel"] p {
    color: #a1a1aa !important;
    font-size: 13px !important;
}
/* Bold labels inside markdown (e.g. "Email (from Google)") */
.stMarkdown b, .stMarkdown strong {
    color: #d4d4d8 !important;
}

/* ══════════════════════════════════════════════════════════════
   6. EXPANDER — smooth dark cards
   ══════════════════════════════════════════════════════════════ */
[data-testid="stExpander"] details {
    background: #0c0c0f !important;
    border: 1px solid rgba(255,255,255,0.05) !important;
    border-radius: 12px !important;
    overflow: hidden !important;
}
[data-testid="stExpander"] details[open] {
    border-color: rgba(255,255,255,0.08) !important;
}
[data-testid="stExpander"] summary {
    font-weight: 600 !important;
    font-size: 14px !important;
    color: #e4e4e7 !important;
    padding: 14px 16px !important;
    background: transparent !important;
    outline: none !important;
    box-shadow: none !important;
}
[data-testid="stExpander"] summary:hover {
    background: transparent !important;
    color: #e4e4e7 !important;
}
[data-testid="stExpander"] summary:focus,
[data-testid="stExpander"] summary:focus-visible,
[data-testid="stExpander"] summary:active,
[data-testid="stExpander"] details[open] > summary {
    background: transparent !important;
    color: #e4e4e7 !important;
    outline: none !important;
    box-shadow: none !important;
}
/* Expander content area */
[data-testid="stExpander"] details > div {
    border-top: 1px solid rgba(255,255,255,0.04) !important;
}

/* ══════════════════════════════════════════════════════════════
   7. BORDERED CONTAINERS (Experience/School cards)
   ══════════════════════════════════════════════════════════════ */
div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"] {
    border: 1px solid rgba(255,255,255,0.05) !important;
    border-radius: 10px !important;
    background: rgba(255,255,255,0.015) !important;
}

/* ══════════════════════════════════════════════════════════════
   8. BUTTONS
   ══════════════════════════════════════════════════════════════ */
button[kind="primary"],
div[data-testid="stFormSubmitButton"] button {
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%) !important;
    color: #fff !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 700 !important;
    box-shadow: 0 4px 14px rgba(34,197,94,0.2) !important;
    transition: box-shadow 0.2s ease !important;
}
button[kind="primary"]:hover {
    box-shadow: 0 6px 20px rgba(34,197,94,0.35) !important;
}
button[kind="secondary"],
.stButton > button {
    background: transparent !important;
    color: #a1a1aa !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 10px !important;
    transition: all 0.15s ease !important;
}
button[kind="secondary"]:hover,
.stButton > button:hover {
    border-color: rgba(34,197,94,0.4) !important;
    color: #22c55e !important;
    background: rgba(34,197,94,0.04) !important;
}

/* ══════════════════════════════════════════════════════════════
   9. TABS
   ══════════════════════════════════════════════════════════════ */
.stTabs [data-baseweb="tab-list"] {
    gap: 0 !important;
    border-bottom: 1px solid rgba(255,255,255,0.06) !important;
    background: transparent !important;
}
.stTabs [data-baseweb="tab"] {
    color: #52525b !important;
    font-weight: 500 !important;
    padding: 10px 20px !important;
    background: transparent !important;
    border: none !important;
}
.stTabs [data-baseweb="tab"]:hover {
    color: #a1a1aa !important;
    background: rgba(255,255,255,0.02) !important;
}
.stTabs [aria-selected="true"] {
    color: #22c55e !important;
    font-weight: 700 !important;
    border-bottom: 2px solid #22c55e !important;
}
.stTabs [data-baseweb="tab-highlight"] {
    background-color: #22c55e !important;
}
.stTabs [data-baseweb="tab-border"] {
    display: none !important;
}

/* ══════════════════════════════════════════════════════════════
   10. CHECKBOXES
   ══════════════════════════════════════════════════════════════ */
.stCheckbox label,
.stCheckbox label span,
.stCheckbox label p {
    color: #d4d4d8 !important;
}

/* ══════════════════════════════════════════════════════════════
   11. FILE UPLOADER
   ══════════════════════════════════════════════════════════════ */
[data-testid="stFileUploader"],
[data-testid="stFileUploader"] > div,
[data-testid="stFileUploader"] section {
    background-color: transparent !important;
    border: none !important;
    color: #a1a1aa !important;
}
[data-testid="stFileUploader"] button {
    background: #111114 !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    color: #a1a1aa !important;
    border-radius: 10px !important;
}

/* ══════════════════════════════════════════════════════════════
   12. FORM CONTAINER
   ══════════════════════════════════════════════════════════════ */
[data-testid="stForm"],
[data-testid="stForm"] > div {
    background-color: #0c0c0f !important;
    border: 1px solid rgba(255,255,255,0.05) !important;
    border-radius: 14px !important;
}

/* ══════════════════════════════════════════════════════════════
   13. ALERTS / INFO / SUCCESS / ERROR
   ══════════════════════════════════════════════════════════════ */
[data-testid="stAlert"] > div,
.stAlert > div {
    background-color: #0f0f12 !important;
    border-radius: 10px !important;
}

/* ══════════════════════════════════════════════════════════════
   14. RADIO (sidebar nav)
   ══════════════════════════════════════════════════════════════ */
.stRadio label span,
div[role="radiogroup"] label span {
    color: #a1a1aa !important;
}

/* ══════════════════════════════════════════════════════════════
   15. SIDEBAR
   ══════════════════════════════════════════════════════════════ */
[data-testid="stSidebar"],
[data-testid="stSidebar"] > div,
[data-testid="stSidebar"] > div > div {
    background-color: #0f0f12 !important;
    border-right: 1px solid rgba(255,255,255,0.04) !important;
}
[data-testid="stSidebar"] * { color: #a1a1aa !important; }

/* ══════════════════════════════════════════════════════════════
   16. DATAFRAME
   ══════════════════════════════════════════════════════════════ */
[data-testid="stDataFrame"],
[data-testid="stDataFrame"] * {
    background-color: #0f0f12 !important;
    color: #d4d4d8 !important;
}

/* ══════════════════════════════════════════════════════════════
   17. TYPOGRAPHY
   ══════════════════════════════════════════════════════════════ */
h1, h2, h3, h4, h5, h6 { color: #fafafa !important; }
h5 { font-size: 13px !important; color: #e4e4e7 !important; }
a { color: #22c55e !important; }

/* ══════════════════════════════════════════════════════════════
   18. SPACING — reduce Streamlit's oversized vertical gaps
   ══════════════════════════════════════════════════════════════ */
div[data-testid="stVerticalBlock"] > div {
    gap: 0.35rem !important;
}

/* ══════════════════════════════════════════════════════════════
   19. SCROLLBAR
   ══════════════════════════════════════════════════════════════ */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }

/* ══════════════════════════════════════════════════════════════
   20. CUSTOM CLASSES (used in st.markdown)
   ══════════════════════════════════════════════════════════════ */
.nav-wrap {
    background: #0c0c0f;
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 8px;
}
.nav-title {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: #52525b;
    font-weight: 700;
    margin-bottom: 8px;
}
.stat-card {
    background: #0c0c0f;
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 13px;
    padding: 18px 16px;
    position: relative;
    overflow: hidden;
}
.stat-card .bar { position: absolute; top: 0; left: 0; right: 0; height: 2px; opacity: 0.6; border-radius: 13px 13px 0 0; }
.stat-card .num { font-size: 28px; font-weight: 800; line-height: 1; }
.stat-card .lbl { font-size: 11px; color: #52525b; font-weight: 600; letter-spacing: 0.04em; margin-top: 6px; text-transform: uppercase; }
.app-row {
    background: #0c0c0f;
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 8px;
    transition: border-color 0.15s;
}
.app-row:hover { border-color: rgba(255,255,255,0.1); }
.eeo-q { font-size: 13px; color: #a1a1aa; margin: 0; padding: 10px 0 6px 0; line-height: 1.4; }
.eeo-row-hr { border: none; border-top: 1px solid rgba(255,255,255,0.04); margin: 0 0 4px 0; }
.logo-pill {
    width: 32px; height: 32px; border-radius: 10px;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0;
}
.muted { color: #a1a1aa; font-size: 13px; }
.dim { color: #52525b; font-size: 11px; }
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
            st.caption(f"Ready to upload: {up.name}")
            if st.button("Upload selected resume", type="primary", key="btn_upload_resume"):
                data = up.getvalue()
                with st.spinner("Uploading…"):
                    resp = api_upload_resume(backend_url, data, up.name)
                if resp.ok:
                    # Rotate uploader widget key to clear selected file chip post-upload.
                    st.session_state["resume_uploader_nonce"] = int(
                        st.session_state.get("resume_uploader_nonce", 0)
                    ) + 1
                    st.rerun()
                else:
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


def render_dashboard(
    backend_url: str,
    profile: dict[str, Any],
    applications: list[dict[str, Any]],
) -> None:
    stats = compute_stats(applications)
    colors = [
        ("#fafafa", "#27272a"),
        ("#a855f7", "rgba(168,85,247,0.15)"),
        ("#22c55e", "rgba(34,197,94,0.15)"),
        ("#f59e0b", "rgba(245,158,11,0.15)"),
    ]
    labels = ["Total applied", "Interviews", "Offers", "Pending"]
    vals = [stats["total"], stats["interview"], stats["offered"], stats["pending"]]

    cards = ""
    for i, lab in enumerate(labels):
        c, ac = colors[i]
        cards += (
            f'<div class="stat-card"><div class="bar" style="background:{c}"></div>'
            f'<div class="num" style="color:{c}">{vals[i]}</div>'
            f'<div class="lbl">{escape(lab)}</div></div>'
        )
    st.markdown(
        f'<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px;">{cards}</div>',
        unsafe_allow_html=True,
    )

    tab_prof, tab_apps = st.tabs(["Profile", "Applications"])
    with tab_prof:
        render_profile_form(backend_url, profile)
    with tab_apps:
        st.session_state.setdefault("apps_search", "")
        st.session_state.setdefault("apps_filter", "all")
        for a in applications:
            aid = int(a["id"])
            st.session_state[f"app_srv_{aid}"] = a.get("status") or "applied"

        s_col, f_col = st.columns([4, 1])
        with s_col:
            st.text_input(
                "Search",
                key="apps_search",
                placeholder="Search applications…",
                label_visibility="collapsed",
            )
        filt_opts = ["all"] + APPLICATION_STATUSES
        if st.session_state.apps_filter not in filt_opts:
            st.session_state.apps_filter = "all"
        with f_col:
            st.selectbox(
                "Filter",
                options=filt_opts,
                key="apps_filter",
                format_func=lambda x: "All statuses" if x == "all" else format_status_option(x),
                label_visibility="collapsed",
            )
        filt = st.session_state.apps_filter
        q = (st.session_state.apps_search or "").lower().strip()

        def match(a: dict[str, Any]) -> bool:
            if filt != "all" and a.get("status") != filt:
                return False
            if not q:
                return True
            return q in (a.get("company_name") or "").lower() or q in (a.get("role_title") or "").lower()

        filtered = [a for a in applications if match(a)]

        if not filtered:
            st.markdown(
                '<div class="stat-card" style="text-align:center;padding:48px 20px;">'
                '<div style="font-size:32px;margin-bottom:10px;opacity:0.4;">📋</div>'
                "<p style='color:#71717a;font-weight:700;margin:0 0 4px;'>No applications found</p>"
                "<p class='dim' style='margin:0;'>Try adjusting search or filter.</p></div>",
                unsafe_allow_html=True,
            )
            return

        for a in filtered:
            co = (a.get("company_name") or "Company").strip() or "Company"
            role = (a.get("role_title") or "").strip() or "Role"
            initial = co[0].upper()
            created = a.get("created_at")
            if isinstance(created, datetime):
                ds = created.strftime("%b %d, %Y")
            else:
                ds = fmt_app_date(str(created) if created else None)
            pu = a.get("portal_url") or ""
            host = portal_host(pu)
            aid = int(a["id"])
            sk = f"app_sel_{aid}"
            if sk not in st.session_state:
                st.session_state[sk] = a.get("status") or "applied"

            r1, r2, r3 = st.columns([2.3, 1.0, 1.0])
            with r1:
                st.markdown(
                    f'<div style="display:flex;align-items:center;gap:14px;min-width:0;">'
                    f'<div style="width:38px;height:38px;border-radius:10px;background:#141418;border:1px solid #1c1c22;'
                    f'display:flex;align-items:center;justify-content:center;font-weight:800;color:#71717a;">{escape(initial)}</div>'
                    f'<div style="min-width:0;"><div style="font-weight:700;font-size:14px;color:#fafafa;">{escape(co)}</div>'
                    f'<div class="muted" style="font-size:12px;">{escape(role)}</div></div></div>',
                    unsafe_allow_html=True,
                )
            with r2:
                st.markdown(
                    f'<div style="text-align:right;"><div class="dim" style="font-size:11px;">{escape(ds)}</div>'
                    f'<div class="dim" style="font-size:10px;">{escape(host)}</div></div>',
                    unsafe_allow_html=True,
                )
            with r3:
                st.selectbox(
                    " ",
                    APPLICATION_STATUSES,
                    key=sk,
                    format_func=format_status_option,
                    label_visibility="collapsed",
                    on_change=_make_app_status_callback(backend_url, aid),
                )
            err = st.session_state.get(f"app_status_err_{aid}")
            if err:
                st.markdown(
                    f'<p style="color:#f87171;font-size:12px;margin:4px 0 12px 0;">{escape(err)}</p>',
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

    # Layout: left nav + main (reference dashboard)
    nav_col, main_col = st.columns([1, 4])
    with nav_col:
        st.markdown(
            '<div class="nav-wrap">'
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">'
            '<div class="logo-pill">⚡</div>'
            '<div><div style="font-size:13px;font-weight:700;">AI Job Assistant</div>'
            '<div style="font-size:9px;color:#52525b;font-weight:600;letter-spacing:0.08em;">APPLICATION PORTAL</div></div>'
            "</div>"
            '<div class="nav-title">NAVIGATION</div>',
            unsafe_allow_html=True,
        )
        nav_main = st.session_state.main_nav
        if st.button("Dashboard", use_container_width=True, type="primary" if nav_main == "dashboard" else "secondary"):
            st.session_state.main_nav = "dashboard"
            st.rerun()
        if st.button("Profile", use_container_width=True, type="primary" if nav_main == "profile" else "secondary"):
            st.session_state.main_nav = "profile"
            st.rerun()
        if st.button("Resume", use_container_width=True, type="primary" if nav_main == "resume" else "secondary"):
            st.session_state.main_nav = "resume"
            st.rerun()
        if st.button("Settings", use_container_width=True, type="primary" if nav_main == "settings" else "secondary"):
            st.session_state.main_nav = "settings"
            st.rerun()

        st.markdown(
            '<div style="margin-top:10px;padding:10px 0;border-top:1px solid #1c1c22;">'
            '<div style="font-size:11px;color:#22c55e;font-weight:600;">● Connected</div></div>',
            unsafe_allow_html=True,
        )
        em = profile.get("email") or ""
        name = profile.get("full_name") or em.split("@")[0] or "User"
        initial = name[:1].upper()
        st.markdown(
            f'<div style="display:flex;align-items:center;gap:9px;padding:8px 0;">'
            f'<div class="logo-pill" style="width:28px;height:28px;border-radius:50%;font-size:11px;">{escape(initial)}</div>'
            f'<div style="min-width:0;"><div style="font-size:12px;font-weight:600;">{escape(name)}</div>'
            f'<div class="dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{escape(em)}</div></div></div>',
            unsafe_allow_html=True,
        )

    with main_col:
        page = st.session_state.main_nav
        if page == "dashboard":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Dashboard</h1>"
                "<p class='muted' style='margin:0;'>Track your applications and manage your job search.</p>",
                unsafe_allow_html=True,
            )
            render_dashboard(backend_url, profile, applications)
        elif page == "profile":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Profile</h1>"
                "<p class='muted' style='margin:0;'>Same fields as the first-time setup in the extension.</p>",
                unsafe_allow_html=True,
            )
            render_profile_form(backend_url, profile)
        elif page == "resume":
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Resumes</h1>"
                f"<p class='muted' style='margin:0;'>Manage your uploaded resumes. Upload up to {MAX_RESUMES}.</p>",
                unsafe_allow_html=True,
            )
            render_resume_page(backend_url)
        else:
            st.markdown(
                "<h1 style='font-size:24px;font-weight:800;margin:0 0 4px;'>Settings</h1>"
                "<p class='muted' style='margin:0;'>Connection and account settings.</p>",
                unsafe_allow_html=True,
            )
            render_settings_page(backend_url, app_url)


if __name__ == "__main__":
    main()
