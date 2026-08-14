const FIELDS = [
  "full_name",
  "email",
  "phone",
  "location",
  "linkedin_url",
  "github_url",
  "website_url",
  "work_authorization",
  "address_line1",
  "city",
  "state",
  "zip_code",
  "country",
];

async function load() {
  const stored = await chrome.storage.local.get(["apiBase", "token"]);
  document.getElementById("apiBase").value = stored.apiBase || "http://localhost:8000";
  document.getElementById("token").value = stored.token || "test-token";
  try {
    const profile = await api("/profile");
    for (const field of FIELDS) {
      if (profile[field]) document.getElementById(field).value = profile[field];
    }
    document.getElementById("needs_sponsorship").checked = Boolean(profile.needs_sponsorship);
  } catch (_err) {
    // Profile may not exist yet.
  }
}

document.getElementById("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    apiBase: document.getElementById("apiBase").value.trim(),
    token: document.getElementById("token").value.trim(),
  });
  document.getElementById("status").textContent = "Connection saved.";
});

document.getElementById("profile").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {};
  for (const field of FIELDS) {
    body[field] = document.getElementById(field).value || null;
  }
  body.needs_sponsorship = document.getElementById("needs_sponsorship").checked;
  try {
    await api("/profile", { method: "PUT", body });
    document.getElementById("status").textContent = "Profile saved.";
  } catch (err) {
    document.getElementById("status").textContent = String(err.message || err);
  }
});

load();
