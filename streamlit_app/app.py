import json
import os
from typing import Any
from urllib.parse import quote_plus

import requests
import streamlit as st


st.set_page_config(
    page_title="AI Job Application Assistant",
    page_icon="AI",
    layout="wide",
)


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


def init_state() -> None:
    st.session_state.setdefault("access_token", None)
    st.session_state.setdefault("refresh_token", None)
    st.session_state.setdefault("profile", None)


def clear_auth_state() -> None:
    st.session_state["access_token"] = None
    st.session_state["refresh_token"] = None
    st.session_state["profile"] = None
    st.query_params.clear()


def api_request(
    backend_url: str,
    path: str,
    *,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    auth_required: bool = True,
) -> requests.Response:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    access_token = st.session_state.get("access_token")
    if auth_required and access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    response = requests.request(
        method=method,
        url=f"{backend_url}{path}",
        headers=headers,
        json=json_body,
        timeout=30,
    )

    if auth_required and response.status_code == 401 and st.session_state.get("refresh_token"):
        refresh = requests.post(
            f"{backend_url}/auth/refresh",
            headers={"Content-Type": "application/json"},
            json={"refresh_token": st.session_state["refresh_token"]},
            timeout=30,
        )
        if refresh.ok:
            new_access = refresh.json().get("access_token")
            if new_access:
                st.session_state["access_token"] = new_access
                headers["Authorization"] = f"Bearer {new_access}"
                response = requests.request(
                    method=method,
                    url=f"{backend_url}{path}",
                    headers=headers,
                    json=json_body,
                    timeout=30,
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


def validate_profile(profile: dict[str, Any]) -> str | None:
    if not (profile.get("full_name") or "").strip():
        return "Full name is required for autofill quality."
    phone = (profile.get("phone") or "").strip()
    if phone and len(phone) < 7:
        return "Phone number looks too short."
    return None


def render_profile_editor(backend_url: str, profile: dict[str, Any]) -> None:
    st.subheader("Profile and Autofill Data")
    st.caption("This data powers autofill in both the web app and extension.")

    col1, col2 = st.columns(2)
    editable: dict[str, Any] = {}

    editable["full_name"] = col1.text_input("Full name", value=profile.get("full_name") or "")
    editable["phone"] = col2.text_input("Phone", value=profile.get("phone") or "")
    editable["city"] = col1.text_input("City", value=profile.get("city") or "")
    editable["state"] = col2.text_input("State", value=profile.get("state") or "")
    editable["country"] = col1.text_input("Country", value=profile.get("country") or "")
    editable["linkedin_url"] = col2.text_input("LinkedIn URL", value=profile.get("linkedin_url") or "")
    editable["github_url"] = col1.text_input("GitHub URL", value=profile.get("github_url") or "")
    editable["portfolio_url"] = col2.text_input("Portfolio URL", value=profile.get("portfolio_url") or "")
    editable["current_title"] = col1.text_input("Current title", value=profile.get("current_title") or "")
    editable["current_company"] = col2.text_input("Current company", value=profile.get("current_company") or "")
    editable["work_authorization"] = col1.text_input(
        "Work authorization",
        value=profile.get("work_authorization") or "",
    )
    editable["visa_status"] = col2.text_input("Visa status", value=profile.get("visa_status") or "")
    editable["expected_salary"] = col1.text_input("Expected salary", value=profile.get("expected_salary") or "")
    editable["salary_currency"] = col2.text_input("Salary currency", value=profile.get("salary_currency") or "")

    custom_fields = profile.get("custom_fields") or {}
    custom_fields_raw = st.text_area(
        "Custom fields (JSON object)",
        value=json.dumps(custom_fields, indent=2),
        height=160,
    )

    if st.button("Save profile", type="primary"):
        try:
            editable["custom_fields"] = json.loads(custom_fields_raw) if custom_fields_raw.strip() else {}
        except json.JSONDecodeError as exc:
            st.error(f"Invalid custom fields JSON: {exc}")
            return

        validation_error = validate_profile(editable)
        if validation_error:
            st.warning(validation_error)
            return

        response = api_request(backend_url, "/users/me/profile", method="PATCH", json_body=editable)
        if response.ok:
            st.session_state["profile"] = response.json()
            st.success("Profile updated.")
            st.rerun()
        else:
            st.error(f"Failed to save profile: {response.text}")


def render_application_tracking(backend_url: str) -> None:
    st.subheader("Application Tracking")
    response = api_request(backend_url, "/me/applications")
    if not response.ok:
        st.error(f"Failed to load applications: {response.text}")
        return

    applications = response.json()
    if not applications:
        st.info("No applications found yet.")
        return

    selected = st.selectbox(
        "Select application",
        options=applications,
        format_func=lambda app: f"#{app['id']} - {app.get('company_name') or 'Unknown'} - {app.get('status')}",
    )

    cols = st.columns(3)
    cols[0].metric("Company", selected.get("company_name") or "Unknown")
    cols[1].metric("Role", selected.get("role_title") or "Unknown")
    cols[2].metric("Status", selected.get("status") or "Unknown")
    st.caption(f"Portal: {selected.get('portal_url') or 'N/A'}")

    status_value = st.selectbox(
        "Update status",
        options=APPLICATION_STATUSES,
        index=max(APPLICATION_STATUSES.index(selected["status"]), 0)
        if selected.get("status") in APPLICATION_STATUSES
        else 0,
    )
    if st.button("Save status"):
        update = api_request(
            backend_url,
            f"/me/applications/{selected['id']}/status",
            method="PATCH",
            json_body={"status": status_value},
        )
        if update.ok:
            st.success("Status updated.")
            st.rerun()
        else:
            st.error(f"Failed to update status: {update.text}")

    events_resp = api_request(backend_url, f"/me/applications/{selected['id']}/events")
    if events_resp.ok:
        st.markdown("#### Events")
        events = events_resp.json()
        if not events:
            st.caption("No events logged for this application yet.")
        for event in events:
            st.write(f"- {event['created_at']} | {event['event_type']} | {event.get('detail') or ''}")
    else:
        st.error(f"Failed to load events: {events_resp.text}")


def main() -> None:
    init_state()

    with st.sidebar:
        backend_url = st.text_input(
            "Backend URL",
            value=os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/"),
        )
        app_url = st.text_input(
            "App URL",
            value=os.environ.get("STREAMLIT_APP_URL", "http://localhost:8501").rstrip("/"),
        )

        try:
            health = requests.get(f"{backend_url}/health", timeout=5)
            if health.ok:
                st.success("Backend connected")
            else:
                st.error("Backend unhealthy")
        except requests.RequestException:
            st.error("Backend unreachable")

        if st.session_state.get("access_token"):
            if st.button("Sign out"):
                clear_auth_state()
                st.rerun()

    if not st.session_state.get("access_token"):
        render_login(backend_url, app_url)
        return

    if st.session_state.get("profile") is None:
        st.session_state["profile"] = fetch_profile(backend_url)

    profile = st.session_state.get("profile")
    if not profile:
        render_login(backend_url, app_url)
        return

    st.title("AI Job Application Assistant")
    st.caption(f"Signed in as {profile.get('email') or profile.get('username')}")

    profile_tab, tracking_tab = st.tabs(["Profile", "Applications"])
    with profile_tab:
        render_profile_editor(backend_url, profile)
    with tracking_tab:
        render_application_tracking(backend_url)


if __name__ == "__main__":
    main()
