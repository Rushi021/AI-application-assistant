import os
from urllib.parse import quote_plus

import requests
import streamlit as st


st.set_page_config(page_title="AI Job Assistant Admin", page_icon="ADMIN", layout="wide")


def init_state() -> None:
    st.session_state.setdefault("access_token", None)
    st.session_state.setdefault("refresh_token", None)


def clear_auth() -> None:
    st.session_state["access_token"] = None
    st.session_state["refresh_token"] = None
    st.query_params.clear()


def auth_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if st.session_state.get("access_token"):
        headers["Authorization"] = f"Bearer {st.session_state['access_token']}"
    return headers


def request_with_refresh(backend_url: str, method: str, path: str, *, json_payload=None) -> requests.Response:
    response = requests.request(
        method=method,
        url=f"{backend_url}{path}",
        headers=auth_headers(),
        json=json_payload,
        timeout=30,
    )
    if response.status_code != 401 or not st.session_state.get("refresh_token"):
        return response

    refresh = requests.post(
        f"{backend_url}/auth/refresh",
        headers={"Content-Type": "application/json"},
        json={"refresh_token": st.session_state["refresh_token"]},
        timeout=30,
    )
    if not refresh.ok:
        return response

    new_access = refresh.json().get("access_token")
    if not new_access:
        return response
    st.session_state["access_token"] = new_access
    return requests.request(
        method=method,
        url=f"{backend_url}{path}",
        headers=auth_headers(),
        json=json_payload,
        timeout=30,
    )


def exchange_code(backend_url: str, code: str) -> bool:
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


def require_admin(backend_url: str) -> bool:
    response = request_with_refresh(backend_url, "GET", "/admin/users?limit=1")
    if response.ok:
        return True
    if response.status_code in (401, 403):
        return False
    st.error(f"Admin check failed: {response.text}")
    return False


def render_login(backend_url: str, admin_app_url: str) -> None:
    st.title("Admin Dashboard")
    st.caption("Sign in with an active admin account.")

    code = st.query_params.get("code")
    if code:
        if exchange_code(backend_url, code):
            st.rerun()

    login_url = f"{backend_url}/auth/web/google/start?next={quote_plus(admin_app_url)}"
    st.link_button("Sign in with Google", login_url, type="primary")


def render_users(backend_url: str) -> None:
    st.subheader("Users")
    search = st.text_input("Search")
    only_active = st.selectbox("Active filter", options=["all", "active", "inactive"])
    only_admin = st.selectbox("Admin filter", options=["all", "admin", "non-admin"])

    query = []
    if search.strip():
        query.append(f"search={quote_plus(search.strip())}")
    if only_active == "active":
        query.append("is_active=true")
    if only_active == "inactive":
        query.append("is_active=false")
    if only_admin == "admin":
        query.append("is_admin=true")
    if only_admin == "non-admin":
        query.append("is_admin=false")
    query.append("limit=200")

    response = request_with_refresh(backend_url, "GET", f"/admin/users?{'&'.join(query)}")
    if not response.ok:
        st.error(f"Failed to load users: {response.text}")
        return

    users = response.json()
    st.dataframe(users, use_container_width=True)

    st.markdown("#### Add user")
    with st.form("add_user"):
        email = st.text_input("Email")
        full_name = st.text_input("Full name")
        is_active = st.checkbox("Active", value=True)
        is_admin = st.checkbox("Admin", value=False)
        submitted = st.form_submit_button("Create user")
        if submitted:
            create = request_with_refresh(
                backend_url,
                "POST",
                "/admin/users",
                json_payload={
                    "email": email,
                    "full_name": full_name or None,
                    "is_active": is_active,
                    "is_admin": is_admin,
                },
            )
            if create.ok:
                st.success("User created.")
                st.rerun()
            else:
                st.error(f"Failed to create user: {create.text}")

    st.markdown("#### Toggle user access")
    if users:
        selected = st.selectbox(
            "Select user",
            options=users,
            format_func=lambda u: f"#{u['id']} | {u.get('email') or u.get('username')} | active={u['is_active']} admin={u['is_admin']}",
        )
        new_active = st.checkbox("Set active", value=selected["is_active"])
        new_admin = st.checkbox("Set admin", value=selected["is_admin"])
        if st.button("Update selected user"):
            patch = request_with_refresh(
                backend_url,
                "PATCH",
                f"/admin/users/{selected['id']}",
                json_payload={"is_active": new_active, "is_admin": new_admin},
            )
            if patch.ok:
                st.success("User updated.")
                st.rerun()
            else:
                st.error(f"Failed to update user: {patch.text}")


def render_behavior(backend_url: str) -> None:
    st.subheader("Applications and Behavior")
    status_filter = st.text_input("Status filter (optional)")
    email_filter = st.text_input("User email filter (optional)")
    query = ["limit=200"]
    if status_filter.strip():
        query.append(f"status={quote_plus(status_filter.strip())}")
    if email_filter.strip():
        query.append(f"user_email={quote_plus(email_filter.strip())}")

    response = request_with_refresh(backend_url, "GET", f"/admin/applications?{'&'.join(query)}")
    if not response.ok:
        st.error(f"Failed to load applications: {response.text}")
        return
    applications = response.json()

    st.dataframe(applications, use_container_width=True)

    if not applications:
        st.caption("No applications found.")
        return

    selected = st.selectbox(
        "Select application",
        options=applications,
        format_func=lambda app: f"#{app['id']} | {app.get('user_email') or 'unknown'} | {app.get('company_name') or 'unknown'} | {app.get('status')}",
    )

    events_resp = request_with_refresh(backend_url, "GET", f"/admin/applications/{selected['id']}/events")
    if not events_resp.ok:
        st.error(f"Failed to load events: {events_resp.text}")
        return

    st.markdown("#### Event Timeline")
    events = events_resp.json()
    if not events:
        st.caption("No events available.")
    for event in events:
        st.write(f"- {event['created_at']} | {event['event_type']} | {event.get('detail') or ''}")


def main() -> None:
    init_state()

    with st.sidebar:
        backend_url = st.text_input(
            "Backend URL",
            value=os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/"),
        )
        admin_app_url = st.text_input(
            "Admin App URL",
            value=os.environ.get("STREAMLIT_ADMIN_URL", "http://localhost:8502").rstrip("/"),
        )
        if st.session_state.get("access_token") and st.button("Sign out"):
            clear_auth()
            st.rerun()

    if not st.session_state.get("access_token"):
        render_login(backend_url, admin_app_url)
        return

    if not require_admin(backend_url):
        clear_auth()
        st.error("Admin access required.")
        render_login(backend_url, admin_app_url)
        return

    st.title("AI Job Assistant Admin")
    users_tab, behavior_tab = st.tabs(["Users", "Behavior"])
    with users_tab:
        render_users(backend_url)
    with behavior_tab:
        render_behavior(backend_url)


if __name__ == "__main__":
    main()
