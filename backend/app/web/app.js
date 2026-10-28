function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safeJobURL(value) { try { const u=new URL(value);return ["http:","https:"].includes(u.protocol)?escapeHTML(u.href):"#"; } catch {return "#";} }
const FAMILIES = [
  { id: "ai_ml", label: "AI / ML" },
  { id: "data_science", label: "Data science" },
  { id: "data_analyst", label: "Data analyst" },
  { id: "business_analyst", label: "Business analyst" },
];

const state = {
  token: "",
  profile: {},
  resumes: [],
  jobs: [],
  applications: [],
};

function $(id) {
  return document.getElementById(id);
}

function banner(message, isError) {
  const el = $("banner");
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.className = "banner" + (isError ? " error" : "");
  el.textContent = message;
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const headers = { Authorization: `Bearer ${state.token}` };
  const opts = { method, headers };
  if (isForm) {
    opts.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : res.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

async function login() {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "testuser", password: "testpass" }),
  });
  if (!res.ok) throw new Error("Could not sign in to the local API.");
  const data = await res.json();
  state.token = data.access_token;
}

function currentRoute() {
  const hash = (location.hash || "#/agent").replace("#/", "");
  return ["agent", "personal", "jobs", "resumes", "tracker"].includes(hash) ? hash : "personal";
}

function route() {
  const name = currentRoute();
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = page.id !== `page-${name}`;
  });
  document.querySelectorAll(".tabs a").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.route === name);
  });
  banner("");
  if (name === "agent" && window.loadAgent) window.loadAgent();
  if (name === "personal") renderProfile();
  if (name === "jobs") renderJobs();
  if (name === "resumes") renderResumes();
  if (name === "tracker") renderTracker();
}

function resumeLabel(resume) {
  if (!resume) return "Select a resume";
  const family = FAMILIES.find((item) => item.id === resume.family);
  return `${family ? family.label : resume.family} · v${resume.version} · ${resume.original_filename}`;
}

function selectedResumeId() {
  return state.profile.preferred_resume_id || (state.resumes[0] && state.resumes[0].id) || null;
}

function fillResumeSelect(selectEl) {
  const current = String(selectEl.value || selectedResumeId() || "");
  selectEl.innerHTML = "";
  if (!state.resumes.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No resumes in the store yet";
    selectEl.appendChild(opt);
    return;
  }
  for (const resume of state.resumes) {
    const opt = document.createElement("option");
    opt.value = resume.id;
    opt.textContent = resumeLabel(resume);
    selectEl.appendChild(opt);
  }
  if ([...selectEl.options].some((opt) => opt.value === current)) selectEl.value = current;
}

async function refresh() {
  const [resumes, jobs, applications] = await Promise.all([
    api("/resumes"),
    api("/jobs"),
    api("/applications"),
  ]);
  state.resumes = resumes;
  state.jobs = jobs;
  state.applications = applications;
  try {
    state.profile = await api("/profile");
  } catch (_err) {
    state.profile = {};
  }
}

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

function money(n) {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function updateSalaryRange() {
  const base = Number($("salary-base").value);
  const out = $("salary-range");
  if (!base) {
    out.value = "";
    return;
  }
  out.value = `${money(base)} – ${money(base + 10000)}`;
}

function updateAuthQuestion() {
  const country = $("work-auth-country").value.trim() || "this country";
  $("auth-question-text").textContent = `Are you legally authorized to work in ${country}?`;
}

function collectEducation() {
  return [...$("education-extra").querySelectorAll(".education-entry")].map((block) => ({
    degree: block.querySelector('[data-edu="degree"]').value || null,
    school_name: block.querySelector('[data-edu="school_name"]').value,
    field_of_study: block.querySelector('[data-edu="field_of_study"]').value,
    graduation_date: block.querySelector('[data-edu="graduation_date"]').value || null,
    gpa: block.querySelector('[data-edu="gpa"]').value,
  }));
}

function addEducation(data = {}) {
  const node = $("education-template").content.firstElementChild.cloneNode(true);
  for (const key of ["degree", "school_name", "field_of_study", "graduation_date", "gpa"]) {
    const el = node.querySelector(`[data-edu="${key}"]`);
    if (el) el.value = data[key] || "";
  }
  node.querySelector("[data-remove-edu]").addEventListener("click", () => node.remove());
  $("education-extra").appendChild(node);
}

function renderEducation() {
  $("education-extra").innerHTML = "";
  for (const entry of state.profile.education || []) {
    addEducation(entry);
  }
}

function renderProfile() {
  const form = $("profile-form");
  const textFields = [
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
    "gender",
    "race_ethnicity",
    "veteran_status",
    "disability_status",
    "highest_degree",
    "school_name",
    "field_of_study",
    "graduation_date",
    "gpa",
    "work_auth_country",
    "citizenship_country",
  ];
  for (const name of textFields) {
    if (form.elements[name]) form.elements[name].value = state.profile[name] || "";
  }
  form.elements.desired_salary_base.value = state.profile.desired_salary_base || "";
  form.elements.willing_to_relocate.value = ynFromProfile(state.profile.willing_to_relocate);
  form.elements.legally_authorized_to_work.value = ynFromProfile(state.profile.legally_authorized_to_work);
  form.elements.needs_sponsorship.value = ynFromProfile(state.profile.needs_sponsorship);
  form.elements.at_least_18.value = ynFromProfile(state.profile.at_least_18);
  form.elements.has_non_compete.value = ynFromProfile(state.profile.has_non_compete);
  updateSalaryRange();
  updateAuthQuestion();
  renderEducation();
}

$("add-education").addEventListener("click", () => addEducation());
$("salary-base").addEventListener("input", updateSalaryRange);
$("work-auth-country").addEventListener("input", updateAuthQuestion);

$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const baseRaw = form.desired_salary_base.value;
  const base = baseRaw === "" ? null : Number(baseRaw);
  const body = {
    first_name: form.first_name.value,
    middle_name: form.middle_name.value,
    last_name: form.last_name.value,
    email: form.email.value,
    phone: form.phone.value,
    location: form.location.value,
    linkedin_url: form.linkedin_url.value,
    github_url: form.github_url.value,
    website_url: form.website_url.value,
    address_line1: form.address_line1.value,
    city: form.city.value,
    state: form.state.value,
    zip_code: form.zip_code.value,
    country: form.country.value,
    preferred_resume_id: state.profile.preferred_resume_id || null,
    desired_salary_base: base,
    desired_salary_min: base,
    desired_salary_max: base === null ? null : base + 10000,
    willing_to_relocate: ynToBool(form.willing_to_relocate.value),
    highest_degree: form.highest_degree.value || null,
    school_name: form.school_name.value,
    field_of_study: form.field_of_study.value,
    graduation_date: form.graduation_date.value || null,
    gpa: form.gpa.value,
    education: collectEducation(),
    work_auth_country: form.work_auth_country.value,
    legally_authorized_to_work: ynToBool(form.legally_authorized_to_work.value),
    needs_sponsorship: ynToBool(form.needs_sponsorship.value),
    citizenship_country: form.citizenship_country.value,
    at_least_18: ynToBool(form.at_least_18.value),
    has_non_compete: ynToBool(form.has_non_compete.value),
    gender: form.gender.value || null,
    race_ethnicity: form.race_ethnicity.value || null,
    veteran_status: form.veteran_status.value || null,
    disability_status: form.disability_status.value || null,
  };
  try {
    state.profile = await api("/profile", { method: "PUT", body });
    banner("Personal information saved. Autofill will use these fields.");
  } catch (err) {
    banner(err.message, true);
  }
});

function jobById(id) {
  return state.jobs.find((job) => job.id === id);
}

function resumeById(id) {
  return state.resumes.find((resume) => resume.id === id);
}

function renderJobs() {
  fillResumeSelect($("job-resume"));
  const root = $("job-list");
  root.innerHTML = "";
  if (!state.jobs.length) {
    root.innerHTML = `<p class="empty">No jobs yet. Paste a description or configure discovery in Agent queue.</p>`;
    return;
  }
  for (const job of state.jobs) {
    const card = document.createElement("article");
    card.className = "card";
    const rec = resumeById(job.recommended_resume_id);
    card.innerHTML = `
      <h3>${escapeHTML(job.company_name || "Company not set")} — ${escapeHTML(job.role || "Role not set")}</h3>
      <p class="meta">${escapeHTML(job.source)} · posted ${escapeHTML(job.date_posted || "—")} · sponsorship ${escapeHTML(job.sponsorship || "—")}</p>
      <p>${escapeHTML((job.raw_text || "").slice(0, 280))}${job.raw_text && job.raw_text.length > 280 ? "…" : ""}</p>
      ${rec ? `<p class="hint">Score suggested ${resumeLabel(rec)}. You still choose the resume above.</p>` : ""}
      <div class="row-actions">
        ${job.application_link ? `<a href="${safeJobURL(job.application_link)}" target="_blank" rel="noreferrer">Open posting</a>` : ""}
        <button type="button" data-score="${job.id}">Score against selected resume</button>
        <button type="button" data-tailor="${job.id}">Tailor and file in library</button>
        <button type="button" data-track="${job.id}">Add to tracker</button>
      </div>
      <pre class="hint" data-evidence="${job.id}"></pre>
    `;
    root.appendChild(card);
  }
  root.querySelectorAll("[data-score]").forEach((btn) => {
    btn.addEventListener("click", () => scoreJob(Number(btn.dataset.score)));
  });
  root.querySelectorAll("[data-tailor]").forEach((btn) => {
    btn.addEventListener("click", () => tailorAndFile(Number(btn.dataset.tailor)));
  });
  root.querySelectorAll("[data-track]").forEach((btn) => {
    btn.addEventListener("click", () => trackJob(Number(btn.dataset.track)));
  });
}

async function tailorAndFile(jobId) {
  const resumeId = Number($("job-resume").value);
  if (!resumeId) {
    banner("Select a resume first. The store is on the Resume store tab.", true);
    return;
  }
  const el = document.querySelector(`[data-evidence="${jobId}"]`);
  try {
    if (el) el.textContent = "Tailoring…";
    const run = await api("/tailoring/runs", {
      method: "POST",
      body: { job_id: jobId, resume_id: resumeId, do_tailor: true },
    });
    const filed = await api(`/tailoring/runs/${run.id}/auto-apply`, { method: "POST" });
    const saved = [filed.exported_docx_path, filed.exported_pdf_path, filed.exported_tex_path].filter(Boolean);
    if (el) {
      el.textContent = [`Saved to ${filed.export_dir}`, ...saved, filed.compiler_warning || ""]
        .filter(Boolean)
        .join("\n");
    }
    banner("Tailored resume filed in its family folder and logged on the tracker.");
    await refresh();
  } catch (err) {
    if (el) el.textContent = "";
    banner(err.message, true);
  }
}

async function scoreJob(jobId) {
  const resumeId = Number($("job-resume").value);
  if (!resumeId) {
    banner("Select a resume first. The store is on the Resume store tab.", true);
    return;
  }
  try {
    const ranked = await api("/matching/score", {
      method: "POST",
      body: { job_id: jobId, resume_id: resumeId },
    });
    const score = ranked.scores[0];
    const el = document.querySelector(`[data-evidence="${jobId}"]`);
    if (el && score) {
      el.textContent = `Selected resume score ${Math.round(score.total_score * 100)}% · must-have ${Math.round(score.must_have_coverage * 100)}% · nice-to-have ${Math.round(score.nice_to_have_coverage * 100)}%`;
    }
    banner("Scored the resume you selected. Suggestion is recorded; it does not override your choice.");
    await refresh();
  } catch (err) {
    banner(err.message, true);
  }
}

async function trackJob(jobId) {
  const resumeId = Number($("job-resume").value);
  if (!resumeId) {
    banner("Select a resume first.", true);
    return;
  }
  try {
    await api("/applications", {
      method: "POST",
      body: { job_id: jobId, resume_id: resumeId, status: "applied" },
    });
    banner("Logged on the tracker with the resume you selected.");
    await refresh();
    renderJobs();
  } catch (err) {
    banner(err.message, true);
  }
}

function chipValues(name) {
  return [...document.querySelectorAll(`[data-chips="${name}"] [data-value]`)].map((el) => el.dataset.value);
}

function addChip(box, value) {
  const text = value.replace(/,$/, "").trim();
  if (!text) return;
  const chips = box.querySelector(".chips");
  const exists = [...chips.querySelectorAll("[data-value]")].some(
    (chip) => chip.dataset.value.toLowerCase() === text.toLowerCase()
  );
  if (exists) return;
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.dataset.value = text;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${text}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => chip.remove());
  chip.append(document.createTextNode(text), remove);
  chips.appendChild(chip);
}

function commitChipInput(input) {
  addChip(input.closest(".chip-box"), input.value);
  input.value = "";
}

document.querySelectorAll(".chip-input").forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitChipInput(input);
    }
    if (event.key === "Backspace" && !input.value) {
      input.closest(".chip-box").querySelector(".chips [data-value]:last-child")?.remove();
    }
  });
  input.addEventListener("blur", () => commitChipInput(input));
});

$("scrape-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  document.querySelectorAll("#scrape-form .chip-input").forEach(commitChipInput);
  const roles = chipValues("roles");
  const locations = chipValues("locations");
  const keywords = chipValues("keywords");
  if (!roles.length || !locations.length) {
    banner("Add at least one role and one location before searching.", true);
    return;
  }
  try {
    const result = await api("/scraping/search", {
      method: "POST",
      body: { roles, locations, keywords, persist: true },
    });
    $("scrape-note").textContent = result.note || `Provider: ${result.provider}`;
    if (!result.results.length) {
      banner("No matching listings returned. Check the source, location and role filters, or paste a job.");
    } else {
      banner(`Saved ${result.results.length} listings.`);
    }
    await refresh();
    renderJobs();
  } catch (err) {
    banner(err.message, true);
  }
});

$("ingest-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/jobs/ingest", {
      method: "POST",
      body: {
        raw_text: form.raw_text.value,
        company_name: form.company_name.value || null,
        role: form.role.value || null,
        sponsorship: form.sponsorship.value || null,
        date_posted: form.date_posted.value || null,
        application_link: form.application_link.value || null,
        source: "manual",
      },
    });
    form.reset();
    banner("Job saved to the list.");
    await refresh();
    renderJobs();
  } catch (err) {
    banner(err.message, true);
  }
});

function renderResumes() {
  const root = $("resume-grid");
  root.innerHTML = "";
  const selected = state.profile.preferred_resume_id;
  for (const family of FAMILIES) {
    const wrap = document.createElement("section");
    wrap.className = "family";
    wrap.innerHTML = `<h3>${family.label}</h3>`;
    for (const version of [1, 2]) {
      const existing = state.resumes.find((item) => item.family === family.id && item.version === version);
      const slot = document.createElement("div");
      slot.className = "version" + (existing && existing.id === selected ? " selected" : "");
      if (existing) {
        slot.innerHTML = `
          <p><strong>Version ${version}</strong> ${existing.id === selected ? '<span class="badge">Selected</span>' : ""}</p>
          <p class="meta">${existing.original_filename} · ${existing.source_format} · ${existing.sections.length} sections</p>
          <div class="row-actions">
            <button type="button" class="ghost" data-select="${existing.id}">Use this resume</button>
            <button type="button" class="bad" data-delete="${existing.id}">Delete</button>
          </div>
        `;
      } else {
        slot.innerHTML = `
          <p><strong>Version ${version}</strong> — empty</p>
          <label>Upload .tex
            <input type="file" accept=".tex,.pdf,.doc,.docx" data-family="${family.id}" data-version="${version}" />
          </label>
        `;
      }
      wrap.appendChild(slot);
    }
    root.appendChild(wrap);
  }
  root.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => selectResume(Number(btn.dataset.select)));
  });
  root.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteResume(Number(btn.dataset.delete)));
  });
  root.querySelectorAll("input[type=file]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.files[0]) uploadResume(input.files[0], input.dataset.family, Number(input.dataset.version));
    });
  });
}

async function selectResume(resumeId) {
  try {
    const body = { ...state.profile, preferred_resume_id: resumeId };
    delete body.id;
    delete body.user_id;
    delete body.updated_at;
    state.profile = await api("/profile", { method: "PUT", body });
    banner("Selected resume saved. Job search and tracker will use this unless you pick another.");
    renderResumes();
  } catch (err) {
    banner(err.message, true);
  }
}

async function deleteResume(resumeId) {
  if (!confirm("Delete this resume version?")) return;
  try {
    await api(`/resumes/${resumeId}`, { method: "DELETE" });
    await refresh();
    renderResumes();
  } catch (err) {
    banner(err.message, true);
  }
}

async function uploadResume(file, family, version) {
  const data = new FormData();
  data.append("file", file);
  data.append("family", family);
  data.append("version", String(version));
  try {
    await api("/resumes/upload", { method: "POST", body: data, isForm: true });
    banner(`Stored ${file.name} as ${family} v${version}.`);
    await refresh();
    renderResumes();
  } catch (err) {
    banner(err.message, true);
  }
}

function renderTracker() {
  const root = $("tracker-table");
  if (!state.applications.length) {
    root.innerHTML = `<p class="empty">No applications logged yet. From Job search, choose a resume and click Tailor and file in library, or Add to tracker.</p>`;
    return;
  }
  const rows = state.applications
    .map((app) => {
      const job = jobById(app.job_id);
      const resume = resumeById(app.resume_id);
      // Prefer what was saved on the row; fall back to a join for older entries.
      const company = app.company_name || job?.company_name || "—";
      const role = app.role || job?.role || "";
      const familyId = app.resume_family || resume?.family;
      const family = FAMILIES.find((item) => item.id === familyId);
      const tailored = app.resume_tailored === null || app.resume_tailored === undefined
        ? "—"
        : app.resume_tailored
        ? "Yes"
        : "No";
      const when = app.applied_at || app.status_updated_at || app.created_at;
      const file = app.document_path ? app.document_path.split("/").pop() : "";
      return `<tr>
        <td>${escapeHTML(company)}<div class="meta">${escapeHTML(role)}</div></td>
        <td>${family ? family.label : familyId || app.resume_id}<div class="meta">${
          resume ? `v${resume.version}` : ""
        }</div></td>
        <td>${tailored}</td>
        <td>${app.status}${app.outcome ? ` · ${app.outcome}` : ""}</td>
        <td class="meta">${when ? new Date(when).toLocaleDateString() : "—"}</td>
        <td class="meta" title="${escapeHTML(app.document_path || "")}">${escapeHTML(file || "—")}</td>
        <td class="row-actions">
          <button type="button" class="ok" data-ok="${app.id}">Succeeded</button>
          <button type="button" class="bad" data-fail="${app.id}">Failed</button>
        </td>
      </tr>`;
    })
    .join("");
  root.innerHTML = `<table>
    <thead><tr>
      <th>Company / role</th><th>Resume type</th><th>Tailored</th>
      <th>Status</th><th>Date applied</th><th>Document</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  root.querySelectorAll("[data-ok]").forEach((btn) => {
    btn.addEventListener("click", () => setOutcome(Number(btn.dataset.ok), true));
  });
  root.querySelectorAll("[data-fail]").forEach((btn) => {
    btn.addEventListener("click", () => setOutcome(Number(btn.dataset.fail), false));
  });
}

async function setOutcome(applicationId, succeeded) {
  try {
    await api(`/applications/${applicationId}/outcome`, { method: "POST", body: { succeeded } });
    await refresh();
    renderTracker();
  } catch (err) {
    banner(err.message, true);
  }
}

window.addEventListener("hashchange", route);

document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !state.token) return;
  const name = currentRoute();
  // Personal information can hold unsaved edits, so never re-render it underneath the user.
  if (name === "personal") return;
  try {
    await refresh();
  } catch (_err) {
    return;
  }
  if (name === "jobs") renderJobs();
  if (name === "resumes") renderResumes();
  if (name === "tracker") renderTracker();
});

(async function start() {
  try {
    await login();
    await refresh();
    route();
  } catch (err) {
    banner(err.message, true);
  }
})();
