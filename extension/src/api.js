const DEFAULTS = {
  apiBase: "http://localhost:8000",
  token: "test-token",
};

async function getSettings() {
  const stored = await chrome.storage.local.get(["apiBase", "token"]);
  return {
    apiBase: stored.apiBase || DEFAULTS.apiBase,
    token: stored.token || DEFAULTS.token,
  };
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const { apiBase, token } = await getSettings();
  const headers = { Authorization: `Bearer ${token}` };
  const opts = { method, headers };
  if (isForm) {
    opts.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${apiBase}${path}`, opts);
  const raw = await res.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = {detail:raw}; }
  if (!res.ok) throw new Error(`${res.status} ${typeof payload?.detail === "string" ? payload.detail : JSON.stringify(payload?.detail || res.statusText)}`);
  return payload;
}

async function login(username, password) {
  const { apiBase } = await getSettings();
  const res = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Login failed");
  const data = await res.json();
  await chrome.storage.local.set({ token: data.access_token });
  return data.access_token;
}
