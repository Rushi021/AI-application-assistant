const FAMILIES = [
  { id: "ai_ml", label: "AI / ML" },
  { id: "data_science", label: "Data science" },
  { id: "data_analyst", label: "Data analyst" },
  { id: "business_analyst", label: "Business analyst" },
];

const state = {
  step: 1,
  jobId: null,
  resumeId: null,
  tailorRunId: null,
  applicationId: null,
  scores: [],
  resumes: [],
};

const stepTitles = {
  1: ["Paste the job description", "Find your strongest resume for this role, then make it yours."],
  2: ["Choose your starting point", "Compare your matches and select the resume you want to use."],
  3: ["Make it yours", "Give your experience a little focus for this opportunity."],
  4: ["Give it a final look", "Your experience, tailored. You’re in control of every edit."],
  5: ["Ready for your next move", "Save your documents, fill the application, and track your progress."],
};

const pendingEdits = new Set();
let saveError = null;

function resizeText(area) {
  area.style.height = "auto";
  area.style.height = `${Math.max(80, area.scrollHeight + 2)}px`;
}

async function saveEdit(task) {
  const status = document.getElementById("saveStatus");
  status.textContent = "Saving changes…";
  const promise = task();
  pendingEdits.add(promise);
  try {
    await promise;
    saveError = null;
    status.textContent = "All changes saved";
  } catch (err) {
    saveError = err;
    status.textContent = "Couldn’t save. Edit the field to try again.";
    showError(err);
  } finally {
    pendingEdits.delete(promise);
  }
}

async function flushEdits() {
  await Promise.allSettled([...pendingEdits]);
  if (saveError) throw new Error("Some edits haven’t saved. Update the field and try again.");
}

function onAction(id, task) {
  const button = document.getElementById(id);
  button.addEventListener("click", async () => {
    const original = [...button.childNodes];
    const controls = [...document.querySelectorAll("button")].filter((item) => !item.disabled);
    controls.forEach((item) => { item.disabled = true; });
    const message = button.dataset.loading || "Working…";
    button.textContent = message;
    button.setAttribute("aria-busy", "true");
    const activity = document.getElementById("activity");
    activity.textContent = message;
    activity.hidden = false;
    try {
      await task();
    } catch (err) {
      showError(err);
    } finally {
      controls.forEach((item) => { item.disabled = false; });
      button.replaceChildren(...original);
      button.removeAttribute("aria-busy");
      activity.hidden = true;
      if (id === "trackBtn" && state.applicationId) button.disabled = true;
    }
  });
}

function showError(err) {
  const el = document.getElementById("error");
  el.hidden = !err;
  el.textContent = err ? String(err.message || err) : "";
  if (err) el.scrollIntoView({ block: "nearest" });
}

function goto(step) {
  state.step = step;
  document.getElementById("stepLabel").textContent = `STEP ${step} OF 5`;
  document.getElementById("stepTitle").textContent = stepTitles[step][0];
  document.getElementById("stepDescription").textContent = stepTitles[step][1];
  document.getElementById("backBtn").hidden = step === 1;
  document.querySelectorAll("[data-step-action]").forEach((button) => {
    button.hidden = Number(button.dataset.stepAction) !== step;
  });
  document.querySelectorAll("#progressSteps li").forEach((item, index) => {
    item.classList.toggle("complete", index + 1 < step);
    if (index + 1 === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    item.querySelector("span").textContent = index + 1 < step ? "✓" : index + 1;
  });
  for (let i = 1; i <= 5; i += 1) {
    document.getElementById(`step-${i}`).hidden = i !== step;
  }
  document.getElementById("mainContent").scrollTop = 0;
  document.getElementById("stepTitle").focus({ preventScroll: true });
  if (step === 4) requestAnimationFrame(() => {
    document.querySelectorAll("#sections details[open] textarea").forEach(resizeText);
  });
}

onAction("ingestBtn", async () => {
  showError(null);
  try {
    const raw = document.getElementById("jd").value.trim();
    if (!raw) throw new Error("Paste a job description first.");
    const job = await api("/jobs/ingest", {
      method: "POST",
      body: {
        raw_text: raw,
        source: "manual",
      },
    });
    state.jobId = job.id;
    await loadResumes();
    await rescore();
    goto(2);
  } catch (err) {
    showError(err);
  }
});

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function resumeById(resumeId) {
  return state.resumes.find((item) => item.id === resumeId) || null;
}

function resumeLabel(resume) {
  const family = FAMILIES.find((item) => item.id === resume.family);
  return `${family ? family.label : resume.family} · v${resume.version}`;
}

function renderScores() {
  const root = document.getElementById("scores");
  root.innerHTML = "";
  if (!state.scores.length) {
    root.textContent = "No base resumes yet. Upload one in the resume store below to get it scored.";
    return;
  }
  for (const score of state.scores) {
    const resume = resumeById(score.resume_id);
    const card = document.createElement("button");
    card.type = "button";
    card.setAttribute("aria-pressed", String(score.resume_id === state.resumeId));
    card.className = "card" + (score.resume_id === state.resumeId ? " selected" : "");
    const title = document.createElement("strong");
    title.textContent = resume ? resumeLabel(resume) : `Resume ${score.resume_id}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = resume ? resume.original_filename : "";
    const numbers = document.createElement("div");
    numbers.className = "coverage";
    numbers.textContent = `Must-have ${pct(
      score.must_have_coverage
    )} · nice-to-have ${pct(score.nice_to_have_coverage)}`;
    const content = document.createElement("div");
    content.className = "score-content";
    if (score.recommended) {
      const badge = document.createElement("span");
      badge.className = "badge mint";
      badge.textContent = "Best match";
      content.appendChild(badge);
    }
    content.append(title, meta, numbers);
    const ring = document.createElement("div");
    ring.className = "score-ring";
    ring.style.setProperty("--score", `${Math.min(100, Math.max(0, (score.total_score || 0) * 100))}%`);
    const value = document.createElement("span");
    value.textContent = pct(score.total_score);
    ring.appendChild(value);
    card.append(content, ring);
    card.addEventListener("click", () => {
      state.resumeId = score.resume_id;
      renderScores();
    });
    root.appendChild(card);
  }
}

async function loadResumes() {
  state.resumes = await api("/resumes");
  renderStore();
}

function renderStore() {
  const root = document.getElementById("storeGrid");
  root.innerHTML = "";
  document.getElementById("store").open = !state.resumes.length;
  for (const family of FAMILIES) {
    const wrap = document.createElement("div");
    wrap.className = "family";
    const head = document.createElement("strong");
    head.textContent = family.label;
    wrap.appendChild(head);
    for (const version of [1, 2]) {
      const existing = state.resumes.find(
        (item) => item.family === family.id && item.version === version
      );
      const slot = document.createElement("div");
      slot.className = "slot";
      if (existing) {
        const name = document.createElement("span");
        name.textContent = `v${version} · ${existing.original_filename}`;
        const remove = document.createElement("button");
        remove.className = "secondary fail";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => {
          if (remove.dataset.armed) {
            deleteResume(existing.id);
            return;
          }
          remove.dataset.armed = "1";
          remove.textContent = "Click again to delete";
        });
        slot.append(name, remove);
      } else {
        const picker = document.createElement("label");
        picker.textContent = `v${version} — upload`;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".tex,.pdf,.doc,.docx";
        input.addEventListener("change", () => {
          if (input.files[0]) uploadResume(input.files[0], family.id, version);
        });
        picker.appendChild(input);
        slot.appendChild(picker);
      }
      wrap.appendChild(slot);
    }
    root.appendChild(wrap);
  }
}

async function rescore() {
  if (!state.jobId) return;
  const ranked = await api("/matching/score", { method: "POST", body: { job_id: state.jobId } });
  state.scores = ranked.scores;
  const scored = state.scores.map((score) => score.resume_id);
  if (!scored.includes(state.resumeId)) {
    state.resumeId = scored.includes(ranked.recommended_resume_id)
      ? ranked.recommended_resume_id
      : null;
  }
  renderScores();
}

async function uploadResume(file, family, version) {
  showError(null);
  try {
    const body = new FormData();
    body.append("file", file);
    body.append("family", family);
    body.append("version", String(version));
    await api("/resumes/upload", { method: "POST", body, isForm: true });
    await loadResumes();
    await rescore();
  } catch (err) {
    showError(err);
  }
}

async function deleteResume(resumeId) {
  showError(null);
  try {
    await api(`/resumes/${resumeId}`, { method: "DELETE" });
    await loadResumes();
    await rescore();
  } catch (err) {
    showError(err);
  }
}

onAction("refreshStoreBtn", async () => {
  showError(null);
  try {
    await loadResumes();
    await rescore();
  } catch (err) {
    showError(err);
  }
});

document.getElementById("toTailor").addEventListener("click", () => {
  if (!state.resumeId) {
    showError(new Error("Select a base resume."));
    return;
  }
  showError(null);
  goto(3);
});

onAction("runTailor", async () => {
  showError(null);
  try {
    const run = await api("/tailoring/runs", {
      method: "POST",
      body: {
        job_id: state.jobId,
        resume_id: state.resumeId,
        do_tailor: document.getElementById("doTailor").checked,
        personalized_instructions: document.getElementById("instructions").value,
      },
    });
    state.tailorRunId = run.id;
    state.applicationId = null;
    saveError = null;
    document.getElementById("trackBtn").disabled = false;
    document.getElementById("outcomePanel").hidden = true;
    document.getElementById("exportPanel").hidden = true;
    renderSections(JSON.parse(run.sections_json || "[]"));
    goto(4);
  } catch (err) {
    showError(err);
  }
});

async function patchLine(section, bullet, text) {
  await api(`/tailoring/runs/${state.tailorRunId}/sections/${section.id}`, {
    method: "PATCH",
    body: { bullets: [{ id: bullet.id, text }] },
  });
}

async function rewrite(section, body) {
  showError(null);
  await flushEdits();
  const updated = await api(
    `/tailoring/runs/${state.tailorRunId}/sections/${section.id}/rewrite`,
    { method: "POST", body }
  );
  renderSections(JSON.parse(updated.sections_json || "[]"));
}

function renderLine(section, bullet, index, wrap) {
  const locked = section.editable === false || bullet.editable === false;
  const row = document.createElement("div");
  row.className = locked ? "line locked" : "line";
  if (locked) {
    row.textContent = bullet.text;
    row.title = `Protected: ${bullet.frozen_reason || "original details"}`;
    wrap.appendChild(row);
    return;
  }
  const area = document.createElement("textarea");
  area.rows = 3;
  area.value = bullet.text || "";
  area.setAttribute("aria-label", `${section.name || "Section"}, line ${index + 1}`);
  area.addEventListener("input", () => resizeText(area));
  area.addEventListener("blur", () => {
    if (area.value === bullet.text) return;
    const text = area.value;
    saveEdit(async () => {
      await patchLine(section, bullet, text);
      bullet.text = text;
    });
  });
  const tools = document.createElement("div");
  tools.className = "line-tools";
  const label = document.createElement("span");
  label.className = "line-label";
  label.textContent = `LINE ${index + 1}`;
  const button = document.createElement("button");
  button.className = "rewrite-line";
  button.textContent = "✦ Refine with AI";
  button.id = `rewrite-${section.id}-${bullet.id}`;
  button.dataset.loading = "Refining…";
  tools.append(label, button);
  row.append(area, tools);
  wrap.appendChild(row);
  onAction(button.id, () => rewrite(section, { bullet_index: index, instructions: "" }));
}

function renderSections(sections) {
  const root = document.getElementById("sections");
  root.innerHTML = "";
  sections.forEach((section) => {
    const locked = section.editable === false;
    const wrap = document.createElement("details");
    wrap.className = locked ? "section locked" : "section";
    wrap.open = !locked;
    const heading = document.createElement("summary");
    heading.className = "section-heading";
    const title = document.createElement("strong");
    title.textContent = section.name || "Section";
    heading.appendChild(title);
    if (locked) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Protected";
      badge.title = section.frozen_reason || "Original details are preserved";
      heading.appendChild(badge);
    }
    const content = document.createElement("div");
    content.className = "section-content";
    wrap.append(heading, content);
    root.appendChild(wrap);
    const bullets = section.bullets || [];
    if (bullets.length) {
      if (!locked && bullets.some((bullet) => bullet.editable !== false)) {
        const all = document.createElement("button");
        all.className = "section-rewrite";
        all.textContent = "✦ Refine section";
        all.id = `rewrite-section-${section.id}`;
        all.dataset.loading = "Refining section…";
        content.appendChild(all);
        onAction(all.id, () => rewrite(section, { instructions: "" }));
      }
      bullets.forEach((bullet, index) => renderLine(section, bullet, index, content));
    } else if (!locked) {
      const area = document.createElement("textarea");
      area.rows = 3;
      area.value = section.body_text || "";
      area.setAttribute("aria-label", section.name || "Section text");
      area.addEventListener("input", () => resizeText(area));
      area.addEventListener("blur", () => {
        if (area.value === section.body_text) return;
        const text = area.value;
        saveEdit(async () => {
          await api(`/tailoring/runs/${state.tailorRunId}/sections/${section.id}`, {
            method: "PATCH", body: { body_text: text },
          });
          section.body_text = text;
        });
      });
      content.appendChild(area);
    } else if (section.body_text) {
      const text = document.createElement("p");
      text.className = "line locked";
      text.textContent = section.body_text;
      content.appendChild(text);
    }
    wrap.addEventListener("toggle", () => {
      if (wrap.open) wrap.querySelectorAll("textarea").forEach(resizeText);
    });
  });
  requestAnimationFrame(() => {
    root.querySelectorAll("details[open] textarea").forEach(resizeText);
  });
}

function showFinal(run) {
  const notes = [];
  if (run.compiler_warning) notes.push(run.compiler_warning);
  if (run.final_docx_key) notes.push(`Wrote ${run.final_docx_key}`);
  if (run.final_pdf_key) notes.push(`Wrote ${run.final_pdf_key}`);
  document.getElementById("finalPreview").textContent =
    notes.join("\n") + (run.final_latex ? `\n\n${run.final_latex}` : "");
}

onAction("finalizeBtn", async () => {
  showError(null);
  try {
    await flushEdits();
    showFinal(await api(`/tailoring/runs/${state.tailorRunId}/finalize`, { method: "POST" }));
    document.getElementById("exportPanel").hidden = true;
    goto(5);
  } catch (err) {
    showError(err);
  }
});

onAction("autoApplyBtn", async () => {
  showError(null);
  const link = document.getElementById("applyLink");
  if (!link.value) link.value = await currentTabUrl();
  try {
    // The company names the file and lands on the tracker row, so persist it first.
    await saveJobDetails();
    const run = await api(`/tailoring/runs/${state.tailorRunId}/auto-apply`, { method: "POST" });
    const panel = document.getElementById("exportPanel");
    const saved = [run.exported_docx_path, run.exported_pdf_path, run.exported_tex_path].filter(Boolean);
    panel.textContent = [`Saved to ${run.export_dir}`, ...saved, "Logged on the tracker."].join("\n");
    panel.hidden = false;
    showFinal(run);
  } catch (err) {
    showError(err);
  }
});

onAction("autofillBtn", async () => {
  showError(null);
  try {
    const result = await chrome.runtime.sendMessage({type:"FILL_CURRENT"});
    if (result?.error) throw new Error(result.error);
  } catch (err) { showError(err); }
});

function jobDetailsPayload() {
  return {
    company_name: document.getElementById("company").value.trim() || null,
    role: document.getElementById("role").value.trim() || null,
    sponsorship: document.getElementById("sponsorship").value.trim() || null,
    date_posted: document.getElementById("datePosted").value.trim() || null,
    application_link: document.getElementById("applyLink").value.trim() || null,
  };
}

async function currentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url && tab.url.startsWith("http") ? tab.url : "";
  } catch (_err) {
    return "";
  }
}

async function saveJobDetails() {
  if (!state.jobId) return;
  await api(`/jobs/${state.jobId}`, { method: "PATCH", body: jobDetailsPayload() });
}

async function createTrackedApplication(status) {
  await saveJobDetails();
  if (state.applicationId) return;
  const created = await api("/applications", {
    method: "POST",
    body: {
      job_id: state.jobId,
      resume_id: state.resumeId,
      tailor_run_id: state.tailorRunId,
      status,
    },
  });
  state.applicationId = created.id;
}

onAction("trackBtn", async () => {
  showError(null);
  try {
    await createTrackedApplication("applied");
    document.getElementById("trackBtn").disabled = true;
    document.getElementById("outcomePanel").hidden = false;
  } catch (err) {
    showError(err);
  }
});

async function recordOutcome(succeeded) {
  showError(null);
  try {
    await createTrackedApplication(succeeded ? "applied" : "failed");
    await api(`/applications/${state.applicationId}/outcome`, {
      method: "POST",
      body: { succeeded },
    });
    document.getElementById("outcomePanel").hidden = false;
    document.getElementById("outcomeStatus").textContent = succeeded ? "Recorded as succeeded." : "Recorded as failed.";
  } catch (err) {
    showError(err);
  }
}

document.getElementById("okBtn").addEventListener("click", () => recordOutcome(true));
document.getElementById("failBtn").addEventListener("click", () => recordOutcome(false));


document.getElementById("backBtn").addEventListener("click", async () => {
  try {
    await flushEdits();
    showError(null);
    goto(Math.max(1, state.step - 1));
  } catch (err) { showError(err); }
});

document.getElementById("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("doTailor").addEventListener("change", (event) => {
  const button = document.getElementById("runTailor");
  button.textContent = event.target.checked ? "✦ Create tailored draft" : "Review original resume →";
  button.dataset.loading = event.target.checked ? "Creating your draft…" : "Preparing your resume…";
});

async function refreshAgentQueue() {
  try {
    await api("/agent/wake", {method:"POST"});
    const items = await api("/agent/queue");
    document.getElementById("agentSummary").textContent = `${items.filter(i=>i.state==="ready").length} packets ready for review · ${items.filter(i=>i.state==="approved").length} approved`;
  } catch (err) { document.getElementById("agentSummary").textContent = err.message; }
}
onAction("openAgent", async () => {
  const {apiBase} = await getSettings(); chrome.tabs.create({url:`${apiBase}/#/agent`});
});
onAction("runApproved", async () => {
  const result = await chrome.runtime.sendMessage({type:"DRAIN_APPROVED"});
  if (result?.error) showError(new Error(result.error));
  refreshAgentQueue();
});
onAction("captureJob", async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const result = await chrome.scripting.executeScript({target:{tabId:tab.id},files:["src/content/capture.js"]});
    document.getElementById("jd").value = result[0].result.raw_text;
  } catch (err) { showError(err); }
});
refreshAgentQueue();

onAction("queueRun",async()=>{
  try {
    await saveJobDetails();
    await api(`/agent/from-run/${state.tailorRunId}`,{method:"POST"});
    const {apiBase}=await getSettings();chrome.tabs.create({url:`${apiBase}/#/agent`});
  } catch(err){showError(err);}
});
