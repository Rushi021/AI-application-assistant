import os
from html import escape
from urllib.parse import quote_plus

import requests
import streamlit as st


st.set_page_config(page_title="AI Job Assistant Admin", page_icon="ADMIN", layout="wide")


def init_state() -> None:
    st.session_state.setdefault("access_token", None)
    st.session_state.setdefault("refresh_token", None)
    st.session_state.setdefault("show_add_user_form", False)


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
    inject_styles()
    st.title("Admin Dashboard")
    st.caption("Sign in with an active admin account.")

    code = st.query_params.get("code")
    if code:
        if exchange_code(backend_url, code):
            st.rerun()

    login_url = f"{backend_url}/auth/web/google/start?next={quote_plus(admin_app_url)}"
    st.link_button("Sign in with Google", login_url, type="primary")


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        .stApp {
            background: #09090b;
            color: #fafafa;
        }
        [data-testid="stSidebar"] {
            background: #0f0f12;
            border-right: 1px solid #1c1c22;
        }
        .admin-shell {
            background: #09090b;
            color: #fafafa;
        }
        .admin-card {
            background: #0f0f12;
            border: 1px solid #1c1c22;
            border-radius: 14px;
            padding: 18px;
            margin-bottom: 16px;
        }
        .admin-kicker {
            font-size: 11px;
            color: #71717a;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-bottom: 6px;
        }
        .admin-muted {
            color: #71717a;
        }
        .admin-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
        }
        .admin-header-icon {
            width: 24px;
            height: 24px;
            border-radius: 8px;
            background: rgba(34,197,94,0.14);
            color: #22c55e;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 700;
        }
        .admin-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .admin-table th {
            color: #3f3f46;
            font-size: 10px;
            text-transform: uppercase;
            text-align: left;
            letter-spacing: 0.08em;
            border-bottom: 1px solid #1c1c22;
            padding: 10px 8px;
        }
        .admin-table td {
            border-bottom: 1px solid #1a1a1f;
            padding: 11px 8px;
            color: #d4d4d8;
        }
        .name-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .name-avatar {
            width: 24px;
            height: 24px;
            border-radius: 999px;
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .badge {
            border-radius: 20px;
            font-size: 11px;
            padding: 2px 8px;
            display: inline-block;
            border: 1px solid transparent;
        }
        .badge-active {
            color: #22c55e;
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.2);
        }
        .badge-inactive {
            color: #ef4444;
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.2);
        }
        .badge-admin {
            color: #a855f7;
            background: rgba(168,85,247,0.1);
            border-color: rgba(168,85,247,0.2);
        }
        .badge-user {
            color: #71717a;
            background: rgba(113,113,122,0.1);
            border-color: rgba(113,113,122,0.2);
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_users(backend_url: str) -> None:
    st.markdown(
        """
        <div style="margin-bottom:16px;">
          <div class="admin-header">
            <span class="admin-header-icon">U</span>
            <h1 style="font-size:26px; font-weight:800; margin:0; letter-spacing:-0.03em;">Users</h1>
          </div>
          <p style="font-size:13px; color:#52525b; margin:6px 0 0;">
            Manage user accounts, permissions, and access control.
          </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown('<div class="admin-card">', unsafe_allow_html=True)
    c1, c2, c3 = st.columns([2, 1, 1])
    with c1:
        st.markdown('<div class="admin-kicker">Search</div>', unsafe_allow_html=True)
        search = st.text_input("Search by name or email", label_visibility="collapsed")
    with c2:
        st.markdown('<div class="admin-kicker">Status</div>', unsafe_allow_html=True)
        only_active = st.selectbox("Active filter", options=["all", "active", "inactive"], label_visibility="collapsed")
    with c3:
        st.markdown('<div class="admin-kicker">Role</div>', unsafe_allow_html=True)
        only_admin = st.selectbox("Admin filter", options=["all", "admin", "non-admin"], label_visibility="collapsed")
    st.markdown("</div>", unsafe_allow_html=True)

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

    table_rows = []
    for u in users:
        active_badge = "badge-active" if u.get("is_active") else "badge-inactive"
        role_badge = "badge-admin" if u.get("is_admin") else "badge-user"
        active_label = "Active" if u.get("is_active") else "Inactive"
        role_label = "Admin" if u.get("is_admin") else "User"
        full_name = str(u.get("full_name") or "")
        avatar_letter = escape((full_name[:1] or "?").upper())
        table_rows.append(
            f"""
            <tr>
              <td>#{u.get("id", "-")}</td>
              <td>{escape(str(u.get("username") or ""))}</td>
              <td>{escape(str(u.get("email") or ""))}</td>
              <td>
                <div class="name-wrap">
                  <span class="name-avatar">{avatar_letter}</span>
                  <span>{escape(full_name)}</span>
                </div>
              </td>
              <td><span class="badge {active_badge}">{active_label}</span></td>
              <td><span class="badge {role_badge}">{role_label}</span></td>
            </tr>
            """
        )

    st.markdown(
        f"""
        <div class="admin-card">
          <table class="admin-table">
            <thead>
              <tr><th>ID</th><th>Username</th><th>Email</th><th>Name</th><th>Status</th><th>Role</th></tr>
            </thead>
            <tbody>
              {''.join(table_rows) if table_rows else '<tr><td colspan="6" class="admin-muted">No users found.</td></tr>'}
            </tbody>
          </table>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown('<div class="admin-card">', unsafe_allow_html=True)
    h1, h2 = st.columns([6, 1])
    with h1:
        st.markdown("#### New user")
    with h2:
        add_btn_label = "Cancel" if st.session_state["show_add_user_form"] else "Add user"
        if st.button(add_btn_label, key="toggle_add_user"):
            st.session_state["show_add_user_form"] = not st.session_state["show_add_user_form"]
            st.rerun()

    if st.session_state["show_add_user_form"]:
        with st.form("add_user", clear_on_submit=True):
            f1, f2 = st.columns(2)
            with f1:
                email = st.text_input("Email")
            with f2:
                full_name = st.text_input("Full name")
            f3, f4 = st.columns(2)
            with f3:
                is_active = st.checkbox("Active", value=True)
            with f4:
                is_admin = st.checkbox("Admin", value=False)
            submitted = st.form_submit_button("Create user", type="primary")
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
                st.session_state["show_add_user_form"] = False
                st.rerun()
            else:
                st.error(f"Failed to create user: {create.text}")
    else:
        st.caption("Click Add user to open the form.")
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown('<div class="admin-card">', unsafe_allow_html=True)
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
    st.markdown("</div>", unsafe_allow_html=True)


def render_behavior(backend_url: str) -> None:
    st.markdown(
        """
        <div style="margin-bottom:16px;">
          <div class="admin-header">
            <span class="admin-header-icon">B</span>
            <h1 style="font-size:26px; font-weight:800; margin:0; letter-spacing:-0.03em;">Behavior</h1>
          </div>
          <p style="font-size:13px; color:#52525b; margin:6px 0 0;">
            Configure AI assistant behavior and application settings.
          </p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown('<div class="admin-card">', unsafe_allow_html=True)
    st.markdown("#### Applications and Behavior")
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
    st.markdown("</div>", unsafe_allow_html=True)


def main() -> None:
    init_state()
    inject_styles()

    with st.sidebar:
        st.markdown("### AI Job Assistant")
        st.caption("ADMIN PANEL")
        section = st.radio("Management", options=["Users", "Behavior"], label_visibility="collapsed")

        with st.expander("Connection", expanded=False):
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

    if "backend_url" not in locals():
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")
        admin_app_url = os.environ.get("STREAMLIT_ADMIN_URL", "http://localhost:8502").rstrip("/")

    if not st.session_state.get("access_token"):
        render_login(backend_url, admin_app_url)
        return

    if not require_admin(backend_url):
        clear_auth()
        st.error("Admin access required.")
        render_login(backend_url, admin_app_url)
        return

    st.markdown('<div class="admin-shell">', unsafe_allow_html=True)
    if section == "Users":
        render_users(backend_url)
    else:
        render_behavior(backend_url)
    st.markdown("</div>", unsafe_allow_html=True)


if __name__ == "__main__":
    main()
