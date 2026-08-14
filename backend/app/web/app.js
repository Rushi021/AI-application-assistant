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

function route() {
  const hash = (location.hash || "#/personal").replace("#/", "");
  const name = ["personal", "jobs", "resumes", "tracker"].includes(hash) ? hash : "personal";
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = page.id !== `page-${name}`;
  });
  document.querySelectorAll(".tabs a").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.route === name);
  });
  banner("");
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

function renderProfile() {
  const form = $("profile-form");
  const fields = [
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
  for (const name of fields) {
    form.elements[name].value = state.profile[name] || "";
  }
  form.elements.needs_sponsorship.checked = Boolean(state.profile.needs_sponsorship);
}

$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = {
    full_name: form.full_name.value,
    email: form.email.value,
    phone: form.phone.value,
    location: form.location.value,
    linkedin_url: form.linkedin_url.value,
    github_url: form.github_url.value,
    website_url: form.website_url.value,
    work_authorization: form.work_authorization.value,
    needs_sponsorship: form.needs_sponsorship.checked,
    address_line1: form.address_line1.value,
    city: form.city.value,
    state: form.state.value,
    zip_code: form.zip_code.value,
    country: form.country.value,
    preferred_resume_id: state.profile.preferred_resume_id || null,
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
    root.innerHTML = `<p class="empty">No jobs yet. Paste a description or run a search (scraper is a placeholder until a provider is wired).</p>`;
    return;
  }
  for (const job of state.jobs) {
    const card = document.createElement("article");
    card.className = "card";
    const rec = resumeById(job.recommended_resume_id);
    card.innerHTML = `
      <h3>${job.company_name || "Company not set"} — ${job.role || "Role not set"}</h3>
      <p class="meta">${job.source} · posted ${job.date_posted || "—"} · sponsorship ${job.sponsorship || "—"}</p>
      <p>${(job.raw_text || "").slice(0, 280)}${job.raw_text && job.raw_text.length > 280 ? "…" : ""}</p>
      ${rec ? `<p class="hint">Score suggested ${resumeLabel(rec)}. You still choose the resume above.</p>` : ""}
      <div class="row-actions">
        ${job.application_link ? `<a href="${job.application_link}" target="_blank" rel="noreferrer">Open posting</a>` : ""}
        <button type="button" data-score="${job.id}">Score against selected resume</button>
        <button type="button" data-track="${job.id}">Add to tracker</button>
      </div>
      <pre class="hint" data-evidence="${job.id}"></pre>
    `;
    root.appendChild(card);
  }
  root.querySelectorAll("[data-score]").forEach((btn) => {
    btn.addEventListener("click", () => scoreJob(Number(btn.dataset.score)));
  });
  root.querySelectorAll("[data-track]").forEach((btn) => {
    btn.addEventListener("click", () => trackJob(Number(btn.dataset.track)));
  });
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

$("scrape-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    const result = await api("/scraping/search", {
      method: "POST",
      body: {
        role: form.role.value,
        location: form.location.value,
        keywords: form.keywords.value,
        persist: true,
      },
    });
    $("scrape-note").textContent = result.note || `Provider: ${result.provider}`;
    if (!result.results.length) {
      banner("Search ran, but the scraper is still a placeholder — no listings yet. Paste a job on the right.");
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
    root.innerHTML = `<p class="empty">No applications logged yet. From Job search, choose a resume and click Add to tracker.</p>`;
    return;
  }
  const rows = state.applications
    .map((app) => {
      const job = jobById(app.job_id);
      const resume = resumeById(app.resume_id);
      const when = app.applied_at || app.status_updated_at || app.created_at;
      return `<tr>
        <td>${job ? `${job.company_name || "—"}<div class="meta">${job.role || ""}</div>` : app.job_id}</td>
        <td>${resume ? resumeLabel(resume) : app.resume_id}</td>
        <td>${app.status}${app.outcome ? ` · ${app.outcome}` : ""}</td>
        <td class="meta">${when ? new Date(when).toLocaleString() : "—"}</td>
        <td class="row-actions">
          <button type="button" class="ok" data-ok="${app.id}">Succeeded</button>
          <button type="button" class="bad" data-fail="${app.id}">Failed</button>
        </td>
      </tr>`;
    })
    .join("");
  root.innerHTML = `<table>
    <thead><tr><th>Job</th><th>Resume you used</th><th>Status</th><th>Date</th><th></th></tr></thead>
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

(async function start() {
  try {
    await login();
    await refresh();
    route();
  } catch (err) {
    banner(err.message, true);
  }
})();
