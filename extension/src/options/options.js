const TEXT_FIELDS = [
  "first_name",
  "middle_name",
  "last_name",
  "email",
  "phone",
  "location",
  "linkedin_url",
  "github_url",
  "website_url",
  "address_line1",
  "city",
  "state",
  "zip_code",
  "country",
  "highest_degree",
  "school_name",
  "field_of_study",
  "graduation_date",
  "gpa",
  "work_auth_country",
  "citizenship_country",
  "gender",
  "race_ethnicity",
  "veteran_status",
  "disability_status",
];

const YES_NO_FIELDS = [
  "willing_to_relocate",
  "legally_authorized_to_work",
  "needs_sponsorship",
  "at_least_18",
  "has_non_compete",
];

function ynFromProfile(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

function ynToBool(value) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function updateSalaryHint() {
  const raw = document.getElementById("desired_salary_base").value;
  const hint = document.getElementById("salary-range-hint");
  const base = Number(raw);
  if (!raw || !base) {
    hint.textContent = "Range is base salary to base + $10,000.";
    return;
  }
  hint.textContent = `Range saved as $${base.toLocaleString()} – $${(base + 10000).toLocaleString()}.`;
}

async function load() {
  const stored = await chrome.storage.local.get(["apiBase", "token"]);
  document.getElementById("apiBase").value = stored.apiBase || "http://localhost:8000";
  document.getElementById("token").value = stored.token || "test-token";
  try {
    const profile = await api("/profile");
    for (const field of TEXT_FIELDS) {
      const el = document.getElementById(field);
      if (el) el.value = profile[field] || "";
    }
    document.getElementById("desired_salary_base").value = profile.desired_salary_base || "";
    for (const field of YES_NO_FIELDS) {
      document.getElementById(field).value = ynFromProfile(profile[field]);
    }
    updateSalaryHint();
  } catch (_err) {
    updateSalaryHint();
  }
}

document.getElementById("desired_salary_base").addEventListener("input", updateSalaryHint);

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
  for (const field of TEXT_FIELDS) {
    body[field] = document.getElementById(field).value || null;
  }
  const baseRaw = document.getElementById("desired_salary_base").value;
  const base = baseRaw === "" ? null : Number(baseRaw);
  body.desired_salary_base = base;
  body.desired_salary_min = base;
  body.desired_salary_max = base === null ? null : base + 10000;
  for (const field of YES_NO_FIELDS) {
    body[field] = ynToBool(document.getElementById(field).value);
  }
  try {
    await api("/profile", { method: "PUT", body });
    document.getElementById("status").textContent = "Profile saved.";
  } catch (err) {
    document.getElementById("status").textContent = String(err.message || err);
  }
});

load();
