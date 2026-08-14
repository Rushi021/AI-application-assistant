const state = {
  step: 1,
  jobId: null,
  resumeId: null,
  tailorRunId: null,
  applicationId: null,
  scores: [],
};

const stepTitles = {
  1: "Step 1 of 5 — Paste JD",
  2: "Step 2 of 5 — Score alignment",
  3: "Step 3 of 5 — Tailor?",
  4: "Step 4 of 5 — Edit sections",
  5: "Step 5 of 5 — Apply + outcome",
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
        company_name: document.getElementById("company").value || null,
        role: document.getElementById("role").value || null,
        sponsorship: document.getElementById("sponsorship").value || null,
        date_posted: document.getElementById("datePosted").value || null,
        application_link: document.getElementById("applyLink").value || null,
        source: "manual",
      },
    });
    state.jobId = job.id;
    const ranked = await api("/matching/score", { method: "POST", body: { job_id: job.id } });
    state.scores = ranked.scores;
    state.resumeId = ranked.recommended_resume_id;
    renderScores();
    goto(2);
  } catch (err) {
    showError(err);
  }
});

function renderScores() {
  const root = document.getElementById("scores");
  root.innerHTML = "";
  if (!state.scores.length) {
    root.textContent = "No active base resumes. Upload .tex files in the backend first.";
    return;
  }
  for (const score of state.scores) {
    const card = document.createElement("div");
    card.className = "card" + (score.resume_id === state.resumeId ? " selected" : "");
    card.innerHTML = `<strong>Resume ${score.resume_id}</strong>
      ${score.recommended ? " · recommended" : ""}<br/>
      total ${(score.total_score * 100).toFixed(0)}%
      · must-have ${(score.must_have_coverage * 100).toFixed(0)}%
      · nice-to-have ${(score.nice_to_have_coverage * 100).toFixed(0)}%`;
    card.addEventListener("click", () => {
      state.resumeId = score.resume_id;
      renderScores();
    });
    root.appendChild(card);
  }
}

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

function renderSections(sections) {
  const root = document.getElementById("sections");
  root.innerHTML = "";
  sections.forEach((section) => {
    const wrap = document.createElement("div");
    wrap.className = "section";
    wrap.innerHTML = `<strong>${section.name || "Section"}</strong>`;
    const area = document.createElement("textarea");
    area.rows = 4;
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
    const rewrite = document.createElement("button");
    rewrite.textContent = "Rewrite section with LLM";
    rewrite.addEventListener("click", async () => {
      try {
        const updated = await api(
          `/tailoring/runs/${state.tailorRunId}/sections/${section.id}/rewrite`,
          { method: "POST", body: { instructions: "" } }
        );
        renderSections(JSON.parse(updated.sections_json || "[]"));
      } catch (err) {
        showError(err);
      }
    });
    wrap.appendChild(rewrite);
    (section.bullets || []).forEach((bullet, index) => {
      const row = document.createElement("div");
      row.textContent = bullet.text;
      const bbtn = document.createElement("button");
      bbtn.textContent = "Rewrite bullet";
      bbtn.addEventListener("click", async () => {
        try {
          const updated = await api(
            `/tailoring/runs/${state.tailorRunId}/sections/${section.id}/rewrite`,
            { method: "POST", body: { bullet_index: index, instructions: "" } }
          );
          renderSections(JSON.parse(updated.sections_json || "[]"));
        } catch (err) {
          showError(err);
        }
      });
      wrap.appendChild(row);
      wrap.appendChild(bbtn);
    });
    root.appendChild(wrap);
  });
}

document.getElementById("finalizeBtn").addEventListener("click", async () => {
  showError(null);
  try {
    const run = await api(`/tailoring/runs/${state.tailorRunId}/finalize`, { method: "POST" });
    document.getElementById("finalPreview").textContent =
      (run.compiler_warning ? run.compiler_warning + "\n\n" : "") + (run.final_latex || "");
    goto(5);
  } catch (err) {
    showError(err);
  }
});

document.getElementById("autofillBtn").addEventListener("click", async () => {
  showError(null);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/autofill.js"],
    });
  } catch (err) {
    showError(err);
  }
});

document.getElementById("applyBtn").addEventListener("click", async () => {
  showError(null);
  try {
    const created = await api("/applications", {
      method: "POST",
      body: {
        job_id: state.jobId,
        resume_id: state.resumeId,
        tailor_run_id: state.tailorRunId,
        status: "applied",
      },
    });
    state.applicationId = created.id;
  } catch (err) {
    showError(err);
  }
});

async function recordOutcome(succeeded) {
  showError(null);
  try {
    if (!state.applicationId) {
      const created = await api("/applications", {
        method: "POST",
        body: {
          job_id: state.jobId,
          resume_id: state.resumeId,
          tailor_run_id: state.tailorRunId,
          status: succeeded ? "applied" : "failed",
        },
      });
      state.applicationId = created.id;
    }
    await api(`/applications/${state.applicationId}/outcome`, {
      method: "POST",
      body: { succeeded },
    });
  } catch (err) {
    showError(err);
  }
}

document.getElementById("okBtn").addEventListener("click", () => recordOutcome(true));
document.getElementById("failBtn").addEventListener("click", () => recordOutcome(false));
