/**
 * Background service worker for the Chrome extension.
 * Handles: side panel open, message routing, auth, session management, application tracking.
 */

import { MSG, STORAGE_KEYS, API_BASE_URL } from "@/shared/constants";
import type { AutofillSession, UserProfile } from "@/shared/types";
import { buildAutofillAnswersFromProfile } from "@/shared/autofill-answers";

// Allow content scripts to read/write chrome.storage.session (answers, trigger, decisions)
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

// Rebuild autofill answers from cached profile on every service worker startup
chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]).then((result) => {
  const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
  if (profile) {
    chrome.storage.local.set({
      [STORAGE_KEYS.AUTOFILL_ANSWERS]: buildAutofillAnswersFromProfile(profile),
    });
  }
}).catch(() => {});

// Open side panel when the extension action (icon) is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => console.error("sidePanel.setPanelBehavior error:", err));

function emitStartResult(ok: boolean, error?: string): void {
  chrome.runtime
    .sendMessage({
      type: MSG.AUTOFILL_START_RESULT,
      data: { ok, error: error ?? null, ts: Date.now() },
    })
    .catch(() => {});
}

function emitDiagTrace(step: string, detail: string, level: "info" | "warn" | "error" = "info"): void {
  const payload = {
    type: MSG.AUTOFILL_DIAG_TRACE,
    data: { source: "background", step, detail, level, ts: Date.now() },
  };
  chrome.runtime.sendMessage(payload).catch(() => {});
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`AUTOFILL TRACE [background] ${step}: ${detail}`);
}

function relayToExtensionViews(message: unknown): void {
  chrome.runtime.sendMessage({
    ...(message as Record<string, unknown>),
    __relayFromBackground: true,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Multi-page autofill session management (chrome.storage.session)
// ---------------------------------------------------------------------------

const SESSION_SUCCESS_URL_PATTERNS = [
  /[/](?:success|thank[\s_-]?you|confirmation|submitted|application[\s_-]?received|completed?)(?:[/?#]|$)/i,
];

function isSuccessUrl(url: string): boolean {
  return SESSION_SUCCESS_URL_PATTERNS.some((p) => p.test(url));
}

async function getAutofillSession(): Promise<AutofillSession | null> {
  const result = await chrome.storage.session.get([STORAGE_KEYS.AUTOFILL_SESSION]);
  return (result[STORAGE_KEYS.AUTOFILL_SESSION] as AutofillSession) ?? null;
}

async function setAutofillSession(session: AutofillSession): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.AUTOFILL_SESSION]: session });
}

async function clearAutofillSession(reason?: string): Promise<void> {
  await chrome.storage.session.remove([STORAGE_KEYS.AUTOFILL_SESSION]);
  relayToExtensionViews({
    type: MSG.AUTOFILL_SESSION_CANCEL,
    data: { reason: reason ?? "unknown" },
  });
  emitDiagTrace("Session", `Session cleared: ${reason ?? "unknown"}`);
}

async function ensureContentScriptInjected(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content/content.js"],
  });
}

/** Deliver a message to every frame in the tab. `tabs.sendMessage` without frameId only hits the main frame. */
async function broadcastToAllFrames(tabId: number, message: object): Promise<void> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  for (const frame of frames) {
    if (frame.errorOccurred) continue;
    chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tab lifecycle for multi-page sessions
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  getAutofillSession().then(async (session) => {
    if (!session?.active || session.tabId !== tabId) return;

    const url = tab.url ?? "";
    if (isSuccessUrl(url)) {
      emitDiagTrace("Session", `Success page detected by URL, ending session: ${url}`);
      await clearAutofillSession("success_url");
      return;
    }

    const updated: AutofillSession = {
      ...session,
      pagesVisited: [...session.pagesVisited, url],
    };
    await setAutofillSession(updated);

    try {
      await ensureContentScriptInjected(tabId);
    } catch {
      // Page may not support injection (e.g. restricted protocol)
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getAutofillSession().then(async (session) => {
    if (session?.tabId === tabId) {
      await chrome.storage.session.remove([STORAGE_KEYS.AUTOFILL_SESSION]);
      emitDiagTrace("Session", `Tab closed, session cleared for tabId=${tabId}`);
    }
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { __relayFromBackground?: boolean }).__relayFromBackground) {
    return false;
  }

  if (message.type === MSG.GET_AUTH_TOKEN) {
    handleGetAuthToken().then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === MSG.GET_USER_PROFILE) {
    chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]).then((result) => {
      sendResponse(result[STORAGE_KEYS.USER_PROFILE] ?? null);
    });
    return true;
  }

  if (message.type === MSG.AUTOFILL_SESSION_STARTED) {
    (async () => {
      try {
        const tabId = message.data?.tabId as number | undefined;
        if (typeof tabId !== "number") {
          sendResponse({ success: false, error: "Missing tabId" });
          return;
        }
        const existing = await getAutofillSession();
        if (existing?.active && existing.tabId !== tabId) {
          await clearAutofillSession("replaced_by_new_session");
        }
        const session: AutofillSession = {
          active: true,
          tabId,
          startedAt: Date.now(),
          filledFieldTypes: [],
          resumeFileUploaded: false,
          pagesVisited: [message.data?.url ?? ""],
          suppressWorkAndSkills: !!message.data?.suppressWorkAndSkills,
          totalFilledAcrossPages: 0,
          totalSkippedAcrossPages: 0,
          totalManualAcrossPages: 0,
        };
        await setAutofillSession(session);
        emitDiagTrace("Session", `Session created for tabId=${tabId}`);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.AUTOFILL_SESSION_CHECK) {
    getAutofillSession().then((session) => {
      if (session?.active && sender.tab?.id === session.tabId) {
        sendResponse({ active: true, session });
      } else {
        sendResponse({ active: false });
      }
    }).catch(() => sendResponse({ active: false }));
    return true;
  }

  if (message.type === MSG.AUTOFILL_SESSION_UPDATE) {
    getAutofillSession().then(async (session) => {
      if (!session?.active) {
        sendResponse({ success: false });
        return;
      }
      const data = message.data ?? {};
      const newTypes = Array.isArray(data.newFilledFieldTypes) ? data.newFilledFieldTypes as string[] : [];
      const merged = new Set([...session.filledFieldTypes, ...newTypes]);
      const updated: AutofillSession = {
        ...session,
        filledFieldTypes: Array.from(merged),
        resumeFileUploaded: session.resumeFileUploaded || data.resumeFileUploaded === true,
        totalFilledAcrossPages: session.totalFilledAcrossPages + (data.filled ?? 0),
        totalSkippedAcrossPages: session.totalSkippedAcrossPages + (data.skipped ?? 0),
        totalManualAcrossPages: session.totalManualAcrossPages + (data.manual ?? 0),
      };
      await setAutofillSession(updated);
      sendResponse({ success: true });
    }).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === MSG.AUTOFILL_SESSION_CANCEL) {
    clearAutofillSession(message.data?.reason ?? "user_cancelled").then(() => {
      sendResponse({ success: true });
    }).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === MSG.RUN_DIRECT_AUTOFILL) {
    (async () => {
      try {
        const tabId = message.data?.tabId as number | undefined;
        if (typeof tabId !== "number") {
          sendResponse({ success: false, error: "Missing tabId" });
          return;
        }
        await ensureContentScriptInjected(tabId);
        await broadcastToAllFrames(tabId, { action: "run_autofill" });
        emitDiagTrace("DirectAutofill", "Forwarded run_autofill to all frames");
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.BROADCAST_RUN_AUTOFILL) {
    (async () => {
      try {
        const tabId = message.data?.tabId as number | undefined;
        if (typeof tabId !== "number") {
          sendResponse({ success: false, error: "Missing tabId" });
          return;
        }
        await ensureContentScriptInjected(tabId);
        await broadcastToAllFrames(tabId, { action: "run_autofill" });
        emitDiagTrace("BroadcastRunAutofill", "Forwarded run_autofill to all frames");
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.START_AUTOFILL) {
    sendResponse({ accepted: true });
    handleStartAutofill().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      emitDiagTrace("StartAutofill", `Unhandled start error: ${msg}`, "error");
      emitStartResult(false, msg);
    });
    return false;
  }

  if (message.type === MSG.STOP_AUTOFILL) {
    clearAutofillSession("user_stopped").catch(() => {});
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_UPLOAD_BLOCKER_DECISION) {
    void (async () => {
      let tabId = sender.tab?.id;
      if (typeof tabId !== "number") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      if (typeof tabId === "number") {
        await broadcastToAllFrames(tabId, message as object);
      }
      relayToExtensionViews(message);
    })();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "TRACK_APPLICATION") {
    trackApplication(message.data).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === MSG.AUTOFILL_DIAG_TRACE) {
    relayToExtensionViews(message);
    return false;
  }

  if (message.type === MSG.AUTOFILL_PROGRESS) {
    relayToExtensionViews(message);
    return false;
  }
});

// ---------------------------------------------------------------------------
// Autofill: inject content script and trigger
// ---------------------------------------------------------------------------

async function handleStartAutofill() {
  try {
    emitDiagTrace("StartAutofill", "START_AUTOFILL received");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      emitDiagTrace("StartAutofill", "No active tab found", "error");
      emitStartResult(false, "No active tab found. Navigate to a job application page first.");
      return;
    }

    const url = tab.url ?? "";
    const restrictedProtocols = ["chrome:", "edge:", "about:", "chrome-extension:", "moz-extension:"];
    if (restrictedProtocols.some((p) => url.startsWith(p))) {
      emitDiagTrace("StartAutofill", `Restricted protocol for url=${url}`, "error");
      emitStartResult(false, "Auto-fill cannot run on this page. Open a job application page and try again.");
      return;
    }

    try {
      await ensureContentScriptInjected(tab.id);
      await new Promise((r) => setTimeout(r, 150));
    } catch (injectErr) {
      const msg = injectErr instanceof Error ? injectErr.message : String(injectErr);
      emitDiagTrace("ScriptInjection", `Injection failed: ${msg}`, "error");
      emitStartResult(false, `Failed to inject script: ${msg}. Try refreshing the page.`);
      return;
    }

    await broadcastToAllFrames(tab.id, { action: "run_autofill" });
    emitDiagTrace("StartAutofill", "Forwarded run_autofill to all frames");
    emitStartResult(true);
  } catch (err) {
    emitStartResult(false, err instanceof Error ? err.message : "Failed to start auto-fill");
  }
}

// ---------------------------------------------------------------------------
// Google OAuth via Chrome Identity API
// ---------------------------------------------------------------------------

async function handleGetAuthToken(): Promise<{ token: string } | { error: string }> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve({ error: chrome.runtime.lastError?.message ?? "Failed to get token" });
      } else {
        resolve({ token });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Application tracking
// ---------------------------------------------------------------------------

async function trackApplication(data?: {
  company_name?: string;
  role_title?: string;
  job_id?: number;
  resume_id?: number;
  portal_url?: string;
  job_description?: string;
  salary?: string | null;
  applied_at?: string;
  status?: string;
  resume_filename?: string | null;
  resume_source?: string | null;
  resume_text?: string | null;
  cover_letter?: string | null;
}): Promise<{
  success: boolean;
  applicationId?: number;
  error?: string;
  reason?: "auth_expired";
  eventsPartialFailure?: boolean;
}> {
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.SESSION_ID,
    ]);

    let accessToken = stored[STORAGE_KEYS.ACCESS_TOKEN];
    const sessionId = stored[STORAGE_KEYS.SESSION_ID];
    if (!accessToken || !sessionId) return { success: false };

    const tryRefreshAccessToken = async (): Promise<string | null> => {
      const refreshData = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN]);
      const refreshToken = refreshData[STORAGE_KEYS.REFRESH_TOKEN];
      if (!refreshToken) return null;
      try {
        const refreshResp = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!refreshResp.ok) return null;
        const refreshJson = await refreshResp.json();
        const nextAccessToken =
          refreshJson && typeof refreshJson === "object" && "access_token" in refreshJson
            ? String((refreshJson as { access_token: unknown }).access_token ?? "")
            : "";
        if (!nextAccessToken) return null;
        await chrome.storage.local.set({ [STORAGE_KEYS.ACCESS_TOKEN]: nextAccessToken });
        accessToken = nextAccessToken;
        return nextAccessToken;
      } catch {
        return null;
      }
    };

    const fetchWithAuthRetry = async (
      url: string,
      options: RequestInit
    ): Promise<{ response: Response | null; authExpired: boolean }> => {
      const firstResp = await fetch(url, options);
      if (firstResp.status !== 401) return { response: firstResp, authExpired: false };
      const refreshedAccessToken = await tryRefreshAccessToken();
      if (!refreshedAccessToken) return { response: null, authExpired: true };
      const retryHeaders = {
        ...(options.headers as Record<string, string>),
        Authorization: `Bearer ${refreshedAccessToken}`,
      };
      const retryResp = await fetch(url, { ...options, headers: retryHeaders });
      if (retryResp.status === 401) return { response: null, authExpired: true };
      return { response: retryResp, authExpired: false };
    };

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const portalUrl = data?.portal_url ?? tab?.url ?? "";
    const tabTitle = tab?.title ?? "";
    const jobBoard = detectJobBoard(portalUrl);
    const derivedRoleTitle = data?.role_title?.trim() || extractRoleFromTitle(tabTitle) || "";
    const derivedCompanyName =
      data?.company_name?.trim() ||
      extractCompanyFromTitle(tabTitle) ||
      extractCompanyFromUrl(portalUrl);
    const status = data?.status?.trim() || "applied";

    const buildAuthHeaders = (): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Session-Id": sessionId,
    });

    const createResult = await fetchWithAuthRetry(`${API_BASE_URL}/applications`, {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        company_name: derivedCompanyName,
        role_title: derivedRoleTitle,
        portal_url: portalUrl,
        job_board: jobBoard,
        job_id: data?.job_id ?? null,
        resume_id: data?.resume_id ?? null,
        status,
        job_description: data?.job_description ?? null,
        salary: data?.salary ?? null,
        resume_filename: data?.resume_filename ?? null,
        resume_source: data?.resume_source ?? null,
        cover_letter: data?.cover_letter ?? null,
      }),
    });
    if (createResult.authExpired || !createResult.response) {
      return { success: false, reason: "auth_expired" };
    }
    if (!createResult.response.ok) {
      return { success: false, error: `Create application failed: HTTP ${createResult.response.status}` };
    }
    const application = await createResult.response.json();

    const snapshot = {
      company_name: derivedCompanyName,
      role_title: derivedRoleTitle,
      portal_url: portalUrl,
      job_board: jobBoard,
      job_description: data?.job_description ?? null,
      salary: data?.salary ?? null,
      applied_at: data?.applied_at ?? new Date().toISOString(),
      status,
      resume: {
        resume_id: data?.resume_id ?? null,
        filename: data?.resume_filename ?? null,
        source: data?.resume_source ?? null,
        content: data?.resume_text ?? null,
      },
      cover_letter: data?.cover_letter ?? null,
      tracked_from: "chrome_extension_done_action",
      captured_tab_title: tabTitle || null,
    };

    let eventsPartialFailure = false;

    try {
      const autofillEventResult = await fetchWithAuthRetry(`${API_BASE_URL}/applications/${application.id}/events`, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          event_type: "autofill_complete",
          detail: `Auto-filled from Chrome extension at ${snapshot.applied_at}`,
        }),
      });
      if (autofillEventResult.authExpired || !autofillEventResult.response) {
        return { success: false, reason: "auth_expired" };
      }
      if (!autofillEventResult.response.ok) eventsPartialFailure = true;
    } catch {
      eventsPartialFailure = true;
    }

    try {
      const snapshotEventResult = await fetchWithAuthRetry(`${API_BASE_URL}/applications/${application.id}/events`, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          event_type: "application_snapshot",
          detail: JSON.stringify(snapshot),
        }),
      });
      if (snapshotEventResult.authExpired || !snapshotEventResult.response) {
        return { success: false, reason: "auth_expired" };
      }
      if (!snapshotEventResult.response.ok) eventsPartialFailure = true;
    } catch {
      eventsPartialFailure = true;
    }

    return {
      success: true,
      applicationId: application.id,
      ...(eventsPartialFailure ? { eventsPartialFailure: true } : {}),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function detectJobBoard(url: string): string {
  if (!url) return "unknown";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("linkedin")) return "LinkedIn";
    if (hostname.includes("indeed")) return "Indeed";
    if (hostname.includes("glassdoor")) return "Glassdoor";
    if (hostname.includes("lever.co")) return "Lever";
    if (hostname.includes("greenhouse.io")) return "Greenhouse";
    if (hostname.includes("workday") || hostname.includes("myworkdayjobs")) return "Workday";
    if (hostname.includes("icims")) return "iCIMS";
    if (hostname.includes("smartrecruiters")) return "SmartRecruiters";
    if (hostname.includes("jobvite")) return "Jobvite";
    if (hostname.includes("taleo")) return "Taleo";
    if (hostname.includes("ashbyhq")) return "Ashby";
    return hostname;
  } catch {
    return "unknown";
  }
}

function extractCompanyFromUrl(url: string): string {
  if (!url) return "";
  try {
    const hostname = new URL(url).hostname;
    return hostname
      .replace(/^(www\.|jobs\.|careers\.|apply\.)/, "")
      .replace(/\.(com|io|co|org|net|jobs).*$/, "")
      .replace(/\./g, " ")
      .replace(/^(\w)/, (m) => m.toUpperCase());
  } catch {
    return "";
  }
}

function extractRoleFromTitle(title: string): string {
  if (!title) return "";
  return title
    .split(/[\|\-–—•]/)
    .map((part) => part.trim())
    .find((part) => /\b(engineer|developer|scientist|manager|analyst|intern|specialist|associate|designer|consultant|lead)\b/i.test(part)) ?? "";
}

function extractCompanyFromTitle(title: string): string {
  if (!title) return "";
  const parts = title
    .split(/[\|\-–—•]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts.find((part) => /\b(careers|jobs|job)\b/i.test(part)) ?? parts[parts.length - 1] ?? "";
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "use-as-jd",
    title: "Use selected text as Job Description",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "use-as-jd" && info.selectionText && tab?.id) {
    chrome.storage.local.set({ detected_jd: info.selectionText });
  }
});
