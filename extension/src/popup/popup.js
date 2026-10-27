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
  1: "Step 1 of 5 — Paste JD",
  2: "Step 2 of 5 — Score alignment",
  3: "Step 3 of 5 — Tailor?",
  4: "Step 4 of 5 — Edit sections",
  5: "Step 5 of 5 — Apply + track",
};

function showError(err) {
  const el = document.getElementById("error");
  el.hidden = !err;
  el.textContent = err ? String(err.message || err) : "";
}

function goto(step) {
  state.step = step;
  document.getElementById("stepLabel").textContent = stepTitles[step];
  for (let i = 1; i <= 5; i += 1) {
    document.getElementById(`step-${i}`).hidden = i !== step;
  }
}

document.getElementById("ingestBtn").addEventListener("click", async () => {
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
    const card = document.createElement("div");
    card.className = "card" + (score.resume_id === state.resumeId ? " selected" : "");
    const title = document.createElement("strong");
    title.textContent =
      (resume ? resumeLabel(resume) : `Resume ${score.resume_id}`) +
      (score.recommended ? " · recommended" : "");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = resume ? resume.original_filename : "";
    const numbers = document.createElement("div");
    numbers.textContent = `total ${pct(score.total_score)} · must-have ${pct(
      score.must_have_coverage
    )} · nice-to-have ${pct(score.nice_to_have_coverage)}`;
    card.append(title, meta, numbers);
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
        remove.className = "fail";
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

document.getElementById("refreshStoreBtn").addEventListener("click", async () => {
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

document.getElementById("runTailor").addEventListener("click", async () => {
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
  const updated = await api(
    `/tailoring/runs/${state.tailorRunId}/sections/${section.id}/rewrite`,
    { method: "POST", body }
  );
  renderSections(JSON.parse(updated.sections_json || "[]"));
}

function renderLine(section, bullet, index, wrap) {
  const row = document.createElement("div");
  row.className = bullet.editable === false ? "line locked" : "line";
  if (bullet.editable === false) {
    row.textContent = bullet.text;
    row.title = `Locked: ${bullet.frozen_reason || "not editable"}`;
    wrap.appendChild(row);
    return;
  }
  const area = document.createElement("textarea");
  area.rows = 2;
  area.value = bullet.text || "";
  area.addEventListener("blur", async () => {
    if (area.value === bullet.text) return;
    try {
      await patchLine(section, bullet, area.value);
      bullet.text = area.value;
    } catch (err) {
      showError(err);
    }
  });
  row.appendChild(area);
  const button = document.createElement("button");
  button.textContent = "Rewrite line";
  button.addEventListener("click", () => rewrite(section, { bullet_index: index, instructions: "" }).catch(showError));
  row.appendChild(button);
  wrap.appendChild(row);
}

function renderSections(sections) {
  const root = document.getElementById("sections");
  root.innerHTML = "";
  sections.forEach((section) => {
    const wrap = document.createElement("div");
    wrap.className = section.editable === false ? "section locked" : "section";
    const heading = document.createElement("strong");
    heading.textContent = section.name || "Section";
    wrap.appendChild(heading);
    if (section.editable === false) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = section.frozen_reason || "locked";
      wrap.appendChild(badge);
    }

    const bullets = section.bullets || [];
    if (bullets.length) {
      if (section.editable !== false) {
        const all = document.createElement("button");
        all.textContent = "Rewrite every line with LLM";
        all.addEventListener("click", () => rewrite(section, { instructions: "" }).catch(showError));
        wrap.appendChild(all);
      }
      bullets.forEach((bullet, index) => renderLine(section, bullet, index, wrap));
    } else if (section.editable !== false) {
      const area = document.createElement("textarea");
      area.rows = 3;
      area.value = section.body_text || "";
      area.addEventListener("blur", async () => {
        try {
          await api(`/tailoring/runs/${state.tailorRunId}/sections/${section.id}`, {
            method: "PATCH",
            body: { body_text: area.value },
          });
        } catch (err) {
          showError(err);
        }
      });
      wrap.appendChild(area);
    }
    root.appendChild(wrap);
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

document.getElementById("finalizeBtn").addEventListener("click", async () => {
  showError(null);
  try {
    showFinal(await api(`/tailoring/runs/${state.tailorRunId}/finalize`, { method: "POST" }));
    goto(5);
  } catch (err) {
    showError(err);
  }
});

document.getElementById("autoApplyBtn").addEventListener("click", async () => {
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

document.getElementById("autofillBtn").addEventListener("click", async () => {
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

document.getElementById("trackBtn").addEventListener("click", async () => {
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
  } catch (err) {
    showError(err);
  }
}

document.getElementById("okBtn").addEventListener("click", () => recordOutcome(true));
document.getElementById("failBtn").addEventListener("click", () => recordOutcome(false));

async function refreshAgentQueue() {
  try {
    await api("/agent/wake", {method:"POST"});
    const items = await api("/agent/queue");
    document.getElementById("agentSummary").textContent = `${items.filter(i=>i.state==="ready").length} packets ready for review · ${items.filter(i=>i.state==="approved").length} approved`;
  } catch (err) { document.getElementById("agentSummary").textContent = err.message; }
}
document.getElementById("openAgent").addEventListener("click", async () => {
  const {apiBase} = await getSettings(); chrome.tabs.create({url:`${apiBase}/#/agent`});
});
document.getElementById("runApproved").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({type:"DRAIN_APPROVED"});
  if (result?.error) showError(new Error(result.error));
  refreshAgentQueue();
});
document.getElementById("captureJob").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const result = await chrome.scripting.executeScript({target:{tabId:tab.id},files:["src/content/capture.js"]});
    document.getElementById("jd").value = result[0].result.raw_text;
  } catch (err) { showError(err); }
});
refreshAgentQueue();

document.getElementById("queueRun").addEventListener("click",async()=>{
  try {
    await saveJobDetails();
    await api(`/agent/from-run/${state.tailorRunId}`,{method:"POST"});
    const {apiBase}=await getSettings();chrome.tabs.create({url:`${apiBase}/#/agent`});
  } catch(err){showError(err);}
});
