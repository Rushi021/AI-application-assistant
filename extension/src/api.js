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
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const payload = await res.json();
      detail = payload.detail || JSON.stringify(payload);
    } catch (_err) {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
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
