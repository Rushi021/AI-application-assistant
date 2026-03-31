import os
from html import escape
from urllib.parse import quote_plus

import requests
import streamlit as st


st.set_page_config(page_title="AI Job Assistant Admin", page_icon="⚡", layout="wide")


# ── helpers ──────────────────────────────────────────────────────────────────

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


def request_with_refresh(
    backend_url: str, method: str, path: str, *, json_payload=None
) -> requests.Response:
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


# ── styles ───────────────────────────────────────────────────────────────────

def inject_styles() -> None:
    st.markdown(
        """
        <style>
        /* ── base ── */
        .stApp {
            background: #09090b !important;
            color: #fafafa;
        }
        [data-testid="stSidebar"] {
            background: #0f0f12 !important;
            border-right: 1px solid #1c1c22 !important;
        }
        [data-testid="stSidebar"] * {
            color: #a1a1aa !important;
        }

        /* ── card ── */
        .admin-card {
            background: #0f0f12;
            border: 1px solid #1c1c22;
            border-radius: 14px;
            padding: 22px;
            margin-bottom: 18px;
        }

        /* ── kicker label ── */
        .admin-kicker {
            font-size: 11px;
            color: #71717a;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-bottom: 6px;
        }

        /* ── page header ── */
        .page-header {
            margin-bottom: 20px;
        }
        .page-header h1 {
            font-size: 26px;
            font-weight: 800;
            margin: 0;
            letter-spacing: -0.03em;
            color: #fafafa;
        }
        .page-header p {
            font-size: 13px;
            color: #52525b;
            margin: 6px 0 0;
        }
        .page-header-icon {
            width: 28px;
            height: 28px;
            border-radius: 8px;
            background: rgba(34,197,94,0.14);
            color: #22c55e;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 700;
            vertical-align: middle;
            margin-right: 8px;
        }

        /* ── table ── */
        .admin-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            table-layout: fixed;
        }
        .admin-table th {
            color: #3f3f46;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            text-align: left;
            letter-spacing: 0.08em;
            border-bottom: 1px solid #1c1c22;
            padding: 10px 10px;
        }
        .admin-table td {
            border-bottom: 1px solid #1a1a1f;
            padding: 12px 10px;
            color: #d4d4d8;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .admin-table tbody tr:hover {
            background: #14141a;
        }
        .admin-table .col-id    { width: 50px; }
        .admin-table .col-user  { width: 25%; }
        .admin-table .col-email { width: 25%; }
        .admin-table .col-name  { width: 22%; }
        .admin-table .col-status{ width: 90px; }
        .admin-table .col-role  { width: 80px; }

        /* ── name cell ── */
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
        .name-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #fafafa;
            font-weight: 600;
        }

        /* ── badges ── */
        .badge {
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 10px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            border: 1px solid transparent;
        }
        .badge-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            display: inline-block;
        }
        .badge-active {
            color: #22c55e;
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.2);
        }
        .badge-active .badge-dot { background: #22c55e; }
        .badge-inactive {
            color: #ef4444;
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.2);
        }
        .badge-inactive .badge-dot { background: #ef4444; }
        .badge-admin {
            color: #a855f7;
            background: rgba(168,85,247,0.1);
            border-color: rgba(168,85,247,0.2);
        }
        .badge-user {
            color: #71717a;
            background: rgba(113,113,122,0.1);
            border-color: rgba(113,113,122,0.15);
        }

        /* ── section heading inside cards ── */
        .section-title {
            font-size: 15px;
            font-weight: 700;
            color: #fafafa;
            margin: 0 0 4px;
        }
        .section-sub {
            font-size: 12px;
            color: #52525b;
            margin: 0 0 16px;
        }

        /* ── streamlit overrides ── */
        .stTextInput > div > div > input,
        .stSelectbox > div > div > div {
            background: #18181b !important;
            border: 1px solid #27272a !important;
            border-radius: 10px !important;
            color: #d4d4d8 !important;
        }
        .stTextInput > div > div > input:focus {
            border-color: #22c55e !important;
            box-shadow: 0 0 0 3px rgba(34,197,94,0.12) !important;
        }
        .stCheckbox label span {
            color: #d4d4d8 !important;
        }
        div[data-testid="stFormSubmitButton"] button,
        .stButton > button[kind="primary"] {
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%) !important;
            color: #fff !important;
            border: none !important;
            border-radius: 10px !important;
            font-weight: 600 !important;
            box-shadow: 0 4px 14px rgba(34,197,94,0.25);
        }
        .stButton > button {
            border-radius: 10px !important;
        }
        h1, h2, h3, h4 {
            color: #fafafa !important;
        }
        .stCaption, .stMarkdown p {
            color: #71717a !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


# ── login ────────────────────────────────────────────────────────────────────

def render_login(backend_url: str, admin_app_url: str) -> None:
    inject_styles()
    st.markdown(
        '<div class="page-header">'
        "<h1>Admin Dashboard</h1>"
        "<p>Sign in with an active admin account.</p>"
        "</div>",
        unsafe_allow_html=True,
    )

    code = st.query_params.get("code")
    if code:
        if exchange_code(backend_url, code):
            st.rerun()

    login_url = (
        f"{backend_url}/auth/web/google/start?next={quote_plus(admin_app_url)}"
    )
    st.link_button("Sign in with Google", login_url, type="primary")


# ── users page ───────────────────────────────────────────────────────────────

def render_users(backend_url: str) -> None:
    # header
    st.markdown(
        '<div class="page-header">'
        '<h1><span class="page-header-icon">U</span>Users</h1>'
        "<p>Manage user accounts, permissions, and access control.</p>"
        "</div>",
        unsafe_allow_html=True,
    )

    # ── filters (native Streamlit widgets) ───────────────────────────────────
    st.markdown(
        '<div class="admin-card">'
        '<div style="display:flex;gap:16px;margin-bottom:8px;">'
        '<div style="flex:2"><div class="admin-kicker">Search</div></div>'
        '<div style="flex:1"><div class="admin-kicker">Status</div></div>'
        '<div style="flex:1"><div class="admin-kicker">Role</div></div>'
        "</div></div>",
        unsafe_allow_html=True,
    )
    fc1, fc2, fc3 = st.columns([2, 1, 1])
    with fc1:
        search = st.text_input(
            "Search by name or email", label_visibility="collapsed"
        )
    with fc2:
        only_active = st.selectbox(
            "Active filter",
            options=["all", "active", "inactive"],
            label_visibility="collapsed",
        )
    with fc3:
        only_admin = st.selectbox(
            "Admin filter",
            options=["all", "admin", "non-admin"],
            label_visibility="collapsed",
        )

    # build query
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

    response = request_with_refresh(
        backend_url, "GET", f"/admin/users?{'&'.join(query)}"
    )
    if not response.ok:
        st.error(f"Failed to load users: {response.text}")
        return

    users = response.json()

    # ── users table (single self-contained HTML block) ───────────────────────
    table_rows = ""
    for u in users:
        active_cls = "badge-active" if u.get("is_active") else "badge-inactive"
        role_cls = "badge-admin" if u.get("is_admin") else "badge-user"
        active_lbl = "Active" if u.get("is_active") else "Inactive"
        role_lbl = "Admin" if u.get("is_admin") else "User"
        full_name = str(u.get("full_name") or "")
        avatar = escape((full_name[:1] or "?").upper())
        table_rows += (
            "<tr>"
            f'<td class="col-id">#{u.get("id", "-")}</td>'
            f'<td class="col-user">{escape(str(u.get("username") or ""))}</td>'
            f'<td class="col-email">{escape(str(u.get("email") or ""))}</td>'
            f'<td class="col-name">'
            f'<div class="name-wrap">'
            f'<span class="name-avatar">{avatar}</span>'
            f'<span class="name-text">{escape(full_name)}</span>'
            f"</div></td>"
            f'<td class="col-status">'
            f'<span class="badge {active_cls}">'
            f'<span class="badge-dot"></span>{active_lbl}</span></td>'
            f'<td class="col-role">'
            f'<span class="badge {role_cls}">{role_lbl}</span></td>'
            "</tr>"
        )

    if not table_rows:
        table_rows = (
            '<tr><td colspan="6" style="text-align:center;color:#3f3f46;'
            'padding:32px 0;">No users found.</td></tr>'
        )

    st.markdown(
        '<div class="admin-card">'
        '<table class="admin-table">'
        "<thead><tr>"
        '<th class="col-id">ID</th>'
        '<th class="col-user">Username</th>'
        '<th class="col-email">Email</th>'
        '<th class="col-name">Name</th>'
        '<th class="col-status">Status</th>'
        '<th class="col-role">Role</th>'
        "</tr></thead>"
        f"<tbody>{table_rows}</tbody>"
        "</table></div>",
        unsafe_allow_html=True,
    )

    # ── add user ─────────────────────────────────────────────────────────────
    st.markdown(
        '<div class="admin-card">'
        '<div class="section-title">New user</div>'
        '<div class="section-sub">'
        "Add a new account to the system.</div></div>",
        unsafe_allow_html=True,
    )

    add_label = "Cancel" if st.session_state["show_add_user_form"] else "＋ Add user"
    if st.button(add_label, key="toggle_add_user"):
        st.session_state["show_add_user_form"] = not st.session_state[
            "show_add_user_form"
        ]
        st.rerun()

    if st.session_state["show_add_user_form"]:
        with st.form("add_user", clear_on_submit=True):
            f1, f2 = st.columns(2)
            with f1:
                email = st.text_input("Email")
            with f2:
                full_name_input = st.text_input("Full name")
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
                    "full_name": full_name_input or None,
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

    # ── toggle user access ───────────────────────────────────────────────────
    st.markdown(
        '<div class="admin-card">'
        '<div class="section-title">Toggle user access</div>'
        '<div class="section-sub">'
        "Quickly update permissions for an existing user.</div></div>",
        unsafe_allow_html=True,
    )

    if users:
        selected = st.selectbox(
            "Select user",
            options=users,
            format_func=lambda u: (
                f"#{u['id']}  —  {u.get('full_name') or u.get('email')}  "
                f"({u.get('email')})"
            ),
            label_visibility="collapsed",
        )
        tc1, tc2 = st.columns(2)
        with tc1:
            new_active = st.checkbox("Set active", value=selected["is_active"])
        with tc2:
            new_admin = st.checkbox("Set admin", value=selected["is_admin"])
        if st.button("Update permissions"):
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
    else:
        st.caption("No users to manage.")


# ── behavior page ────────────────────────────────────────────────────────────

def render_behavior(backend_url: str) -> None:
    st.markdown(
        '<div class="page-header">'
        '<h1><span class="page-header-icon">B</span>Behavior</h1>'
        "<p>Configure AI assistant behavior and application settings.</p>"
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown(
        '<div class="admin-card">'
        '<div class="section-title">Applications &amp; Behavior</div>'
        '<div class="section-sub">'
        "Filter and inspect tracked applications.</div></div>",
        unsafe_allow_html=True,
    )

    bc1, bc2 = st.columns(2)
    with bc1:
        status_filter = st.text_input("Status filter (optional)")
    with bc2:
        email_filter = st.text_input("User email filter (optional)")

    bq = ["limit=200"]
    if status_filter.strip():
        bq.append(f"status={quote_plus(status_filter.strip())}")
    if email_filter.strip():
        bq.append(f"user_email={quote_plus(email_filter.strip())}")

    response = request_with_refresh(
        backend_url, "GET", f"/admin/applications?{'&'.join(bq)}"
    )
    if not response.ok:
        st.error(f"Failed to load applications: {response.text}")
        return

    applications = response.json()
    st.dataframe(applications, use_container_width=True)

    if not applications:
        st.caption("No applications found.")
        return

    selected_app = st.selectbox(
        "Select application",
        options=applications,
        format_func=lambda app: (
            f"#{app['id']}  |  "
            f"{app.get('user_email') or 'unknown'}  |  "
            f"{app.get('company_name') or 'unknown'}  |  "
            f"{app.get('status')}"
        ),
    )

    events_resp = request_with_refresh(
        backend_url, "GET", f"/admin/applications/{selected_app['id']}/events"
    )
    if not events_resp.ok:
        st.error(f"Failed to load events: {events_resp.text}")
        return

    st.markdown(
        '<div class="admin-card">'
        '<div class="section-title">Event Timeline</div></div>',
        unsafe_allow_html=True,
    )
    events = events_resp.json()
    if not events:
        st.caption("No events available.")
    for ev in events:
        st.write(
            f"- {ev['created_at']}  |  {ev['event_type']}  |  "
            f"{ev.get('detail') or ''}"
        )


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    init_state()
    inject_styles()

    with st.sidebar:
        st.markdown("### ⚡ AI Job Assistant")
        st.caption("ADMIN PANEL")
        section = st.radio(
            "Management",
            options=["Users", "Behavior"],
            label_visibility="collapsed",
        )

        with st.expander("Connection", expanded=False):
            backend_url = st.text_input(
                "Backend URL",
                value=os.environ.get(
                    "BACKEND_URL", "http://localhost:8000"
                ).rstrip("/"),
            )
            admin_app_url = st.text_input(
                "Admin App URL",
                value=os.environ.get(
                    "STREAMLIT_ADMIN_URL", "http://localhost:8502"
                ).rstrip("/"),
            )
        if st.session_state.get("access_token") and st.button("Sign out"):
            clear_auth()
            st.rerun()

    if "backend_url" not in locals():
        backend_url = os.environ.get(
            "BACKEND_URL", "http://localhost:8000"
        ).rstrip("/")
        admin_app_url = os.environ.get(
            "STREAMLIT_ADMIN_URL", "http://localhost:8502"
        ).rstrip("/")

    if not st.session_state.get("access_token"):
        render_login(backend_url, admin_app_url)
        return

    if not require_admin(backend_url):
        clear_auth()
        st.error("Admin access required.")
        render_login(backend_url, admin_app_url)
        return

    if section == "Users":
        render_users(backend_url)
    else:
        render_behavior(backend_url)


if __name__ == "__main__":
    main()
