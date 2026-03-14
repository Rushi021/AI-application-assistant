/**
 * Background service worker for the Chrome extension.
 * Handles: side panel open on action click, message routing, auth state, application tracking.
 */

import { MSG, STORAGE_KEYS, API_BASE_URL } from "@/shared/constants";

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
    data: {
      source: "background",
      step,
      detail,
      level,
      ts: Date.now(),
    },
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

async function listFrameIds(tabId: number): Promise<number[]> {
  try {
    emitDiagTrace("FrameDiscovery", `Listing frames for tabId=${tabId}`);
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({ href: window.location.href, isTop: window === window.top }),
    });
    emitDiagTrace("FrameDiscovery", `Found frame results count=${results.length}`);
    return results
      .map((r) => r.frameId)
      .filter((id): id is number => typeof id === "number");
  } catch {
    emitDiagTrace("FrameDiscovery", `Frame listing failed; falling back to frameId=0`, "warn");
    return [0];
  }
}

async function sendMessageToFrame<T>(
  tabId: number,
  message: unknown,
  timeoutMs: number,
  frameId?: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `No response within ${timeoutMs}ms${frameId != null ? ` (frameId=${frameId})` : ""}`
        )
      );
    }, timeoutMs);

    const options = frameId != null ? { frameId } : undefined;
    chrome.tabs.sendMessage(tabId, message, options as never, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "tabs.sendMessage failed"));
        return;
      }
      resolve(response as T);
    });
  });
}

async function broadcastToActiveTabFrames(
  message: unknown,
  timeoutMs = 2500
): Promise<{ success: boolean; successCount: number; errors: string[] }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false, successCount: 0, errors: ["No active tab found"] };
  }

  const frameIds = await listFrameIds(tab.id);
  let successCount = 0;
  const errors: string[] = [];

  for (const frameId of frameIds) {
    try {
      const response = await sendMessageToFrame<{ success?: boolean; error?: string }>(
        tab.id,
        message,
        timeoutMs,
        frameId
      );
      if (response?.error) {
        errors.push(`frameId=${frameId}: ${response.error}`);
      } else {
        successCount += 1;
      }
    } catch (err) {
      errors.push(`frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { success: successCount > 0, successCount, errors };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { __relayFromBackground?: boolean }).__relayFromBackground) {
    return false;
  }

  if (message.type === MSG.GET_AUTH_TOKEN) {
    handleGetAuthToken().then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true; // async response
  }

  if (message.type === MSG.GET_USER_PROFILE) {
    chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]).then((result) => {
      sendResponse(result[STORAGE_KEYS.USER_PROFILE] ?? null);
    });
    return true;
  }

  if (message.type === MSG.START_AUTOFILL) {
    sendResponse({ accepted: true });
    handleStartAutofill(!!message.data?.suppressWorkAndSkills).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      emitDiagTrace("StartAutofill", `Unhandled start error: ${msg}`, "error");
      emitStartResult(false, msg);
    });
    return false;
  }

  if (message.type === MSG.RUN_AUTOFILL_DIAGNOSTICS) {
    handleRunAutofillDiagnostics(sendResponse);
    return true;
  }

  if (message.type === MSG.IFRAME_RELOADED) {
    console.log("AUTOFILL: iframe reloaded", message.data ?? null);
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_UNDO_ALL) {
    broadcastToActiveTabFrames(message).then((result) => {
      sendResponse({
        success: result.success,
        relayedFrames: result.successCount,
        error: result.success ? undefined : result.errors.join(" | "),
      });
    });
    return true;
  }

  if (message.type === MSG.STOP_AUTOFILL) {
    broadcastToActiveTabFrames(message).then((result) => {
      sendResponse({
        success: result.success,
        relayedFrames: result.successCount,
        error: result.success ? undefined : result.errors.join(" | "),
      });
    });
    return true;
  }

  if (message.type === MSG.AUTOFILL_RESUME) {
    broadcastToActiveTabFrames(message).then((result) => {
      sendResponse({
        success: result.success,
        relayedFrames: result.successCount,
        error: result.success ? undefined : result.errors.join(" | "),
      });
    });
    return true;
  }

  if (message.type === MSG.AUTOFILL_UPLOAD_BLOCKER_DECISION) {
    broadcastToActiveTabFrames(message).then((result) => {
      sendResponse({
        success: result.success,
        relayedFrames: result.successCount,
        error: result.success ? undefined : result.errors.join(" | "),
      });
    });
    return true;
  }

  // Track application after autofill completes
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
// Autofill: inject content script and forward to tab
// ---------------------------------------------------------------------------

async function handleStartAutofill(suppressWorkAndSkills = false) {
  try {
    console.log("AUTOFILL: START_AUTOFILL received from side panel");
    emitDiagTrace("StartAutofill", "START_AUTOFILL received from side panel");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      emitDiagTrace("StartAutofill", "No active tab found", "error");
      emitStartResult(false, "No active tab found. Navigate to a job application page first.");
      return;
    }
    console.log("AUTOFILL: active tab", { id: tab.id, url: tab.url, status: tab.status });

    const url = tab.url ?? "";
    const restrictedProtocols = ["chrome:", "edge:", "about:", "chrome-extension:", "moz-extension:"];
    if (restrictedProtocols.some((p) => url.startsWith(p))) {
      emitDiagTrace("StartAutofill", `Restricted protocol for url=${url}`, "error");
      emitStartResult(
        false,
        "Auto-fill cannot run on this page. Open a job application page (e.g., LinkedIn, Indeed, Lever, Greenhouse) and try again."
      );
      return;
    }

    // Inject content script (required for pages opened before extension load, or when manifest injection missed)
    try {
      console.log("AUTOFILL: injecting content script");
      emitDiagTrace("ScriptInjection", `Injecting content script into all frames for tabId=${tab.id}`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/content.js"],
      });
      await new Promise((r) => setTimeout(r, 200));
      emitDiagTrace("ScriptInjection", "Content script injection completed");
    } catch (injectErr) {
      const msg = injectErr instanceof Error ? injectErr.message : String(injectErr);
      console.error("AUTOFILL: injection failed", injectErr);
      emitDiagTrace("ScriptInjection", `Injection failed: ${msg}`, "error");
      emitStartResult(
        false,
        `Failed to inject script: ${msg}. Try refreshing the page and ensure you're loading the extension from the 'dist' folder after running 'npm run build'.`
      );
      return;
    }

    console.log("AUTOFILL: sending START_AUTOFILL to tab");
    const frameIds = await listFrameIds(tab.id);
    const startErrors: string[] = [];
    const startPayload = {
      type: MSG.START_AUTOFILL,
      data: { suppressWorkAndSkills },
    };
    emitDiagTrace("FrameDiscovery", `Start flow frameIds=${frameIds.join(",")}`);
    for (const frameId of frameIds) {
      try {
        emitDiagTrace("FrameStartAttempt", `Sending START_AUTOFILL to frameId=${frameId}`);
        const response = await sendMessageToFrame<{ success?: boolean; error?: string }>(
          tab.id,
          startPayload,
          5000,
          frameId
        );
        if (response?.error) {
          emitDiagTrace("FrameStartAttempt", `Frame responded with error frameId=${frameId}: ${response.error}`, "warn");
          startErrors.push(`frameId=${frameId}: ${response.error}`);
          continue;
        }
        emitDiagTrace("FrameStartAttempt", `Frame accepted START_AUTOFILL frameId=${frameId}`);
        console.log("AUTOFILL: sendMessage response", { frameId, response });
        emitStartResult(true);
        return;
      } catch (err) {
        emitDiagTrace("FrameStartAttempt", `Frame call failed frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`, "warn");
        startErrors.push(`frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    emitDiagTrace("StartAutofill", `No frame accepted START_AUTOFILL; attempts=${startErrors.join(" | ")}`, "error");
    emitStartResult(
      false,
      "Could not connect to a responsive frame on this page. This job form may run inside a protected iframe. " +
        `Frame attempts: ${startErrors.join(" | ")}`
    );
  } catch (err) {
    console.error("AUTOFILL: handleStartAutofill error", err);
    emitStartResult(false, err instanceof Error ? err.message : "Failed to start auto-fill");
  }
}

async function handleRunAutofillDiagnostics(sendResponse: (response: unknown) => void) {
  try {
    emitDiagTrace("Diagnostics", "RUN_AUTOFILL_DIAGNOSTICS received from side panel");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      emitDiagTrace("Diagnostics", "No active tab found", "error");
      sendResponse({ error: "No active tab found." });
      return;
    }

    const url = tab.url ?? "";
    const restrictedProtocols = ["chrome:", "edge:", "about:", "chrome-extension:", "moz-extension:"];
    if (restrictedProtocols.some((p) => url.startsWith(p))) {
      emitDiagTrace("Diagnostics", `Restricted protocol for url=${url}`, "error");
      sendResponse({ error: "Diagnostics cannot run on this page type." });
      return;
    }

    try {
      emitDiagTrace("ScriptInjection", `Injecting content script into all frames for diagnostics tabId=${tab.id}`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content/content.js"],
      });
      await new Promise((r) => setTimeout(r, 200));
      emitDiagTrace("ScriptInjection", "Diagnostics content script injection completed");
    } catch (injectErr) {
      const msg = injectErr instanceof Error ? injectErr.message : String(injectErr);
      emitDiagTrace("ScriptInjection", `Diagnostics injection failed: ${msg}`, "error");
      sendResponse({ error: `Failed to inject content script: ${msg}` });
      return;
    }

    const frameIds = await listFrameIds(tab.id);
    const pingErrors: string[] = [];
    const responsiveFrameIds: number[] = [];
    emitDiagTrace("FrameDiscovery", `Diagnostics frameIds=${frameIds.join(",")}`);
    for (const frameId of frameIds) {
      try {
        emitDiagTrace("FramePing", `Pinging frameId=${frameId}`);
        await sendMessageToFrame<{ ok: boolean; isTopFrame: boolean; href: string }>(
          tab.id,
          { type: MSG.AUTOFILL_PING },
          2500,
          frameId
        );
        emitDiagTrace("FramePing", `Ping OK frameId=${frameId}`);
        responsiveFrameIds.push(frameId);
      } catch (err) {
        emitDiagTrace("FramePing", `Ping failed frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`, "warn");
        pingErrors.push(`frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (responsiveFrameIds.length === 0) {
      sendResponse({
        error:
          "No responsive content-script frame found for diagnostics. " +
          `Ping attempts: ${pingErrors.join(" | ")}`,
      });
      return;
    }

    const diagErrors: string[] = [];
    for (const frameId of responsiveFrameIds) {
      try {
        emitDiagTrace("FrameDiagnostics", `Requesting diagnostics on frameId=${frameId}`);
        const response = await sendMessageToFrame<{ ok?: boolean; steps?: unknown[]; error?: string }>(
          tab.id,
          { type: MSG.RUN_AUTOFILL_DIAGNOSTICS },
          20000,
          frameId
        );
        if (response?.error) {
          emitDiagTrace("FrameDiagnostics", `Frame diagnostics returned error frameId=${frameId}: ${response.error}`, "warn");
          diagErrors.push(`frameId=${frameId}: ${response.error}`);
          continue;
        }
        emitDiagTrace("FrameDiagnostics", `Diagnostics succeeded on frameId=${frameId}`);
        sendResponse(response ?? { error: "No diagnostics response from content script." });
        return;
      } catch (err) {
        emitDiagTrace("FrameDiagnostics", `Frame diagnostics call failed frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`, "warn");
        diagErrors.push(`frameId=${frameId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    emitDiagTrace(
      "Diagnostics",
      `Diagnostics failed on all responsive frames; responsive=${responsiveFrameIds.join(",")} pingFailures=${pingErrors.join(" | ") || "none"} diagFailures=${diagErrors.join(" | ")}`,
      "error"
    );
    sendResponse({
      error:
        "Diagnostics failed on all responsive frames. The form may be in a protected cross-origin iframe, or DOM scanning is hanging. " +
        `Responsive frames=${responsiveFrameIds.join(",")}; ping failures=${pingErrors.join(" | ") || "none"}; diagnostics failures=${diagErrors.join(" | ")}`,
    });
  } catch (err) {
    sendResponse({ error: err instanceof Error ? err.message : "Diagnostics failed." });
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
  company_from_title?: string | null;
}): Promise<{ success: boolean; applicationId?: number; error?: string }> {
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.SESSION_ID,
    ]);

    const accessToken = stored[STORAGE_KEYS.ACCESS_TOKEN];
    const sessionId = stored[STORAGE_KEYS.SESSION_ID];
    if (!accessToken || !sessionId) return { success: false };

    // Get the current tab URL as the portal URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const portalUrl = data?.portal_url ?? tab?.url ?? "";
    const tabTitle = tab?.title ?? "";

    // Try to detect job board from URL
    const jobBoard = detectJobBoard(portalUrl);
    const derivedRoleTitle = data?.role_title?.trim() || extractRoleFromTitle(tabTitle) || "";
    const derivedCompanyName =
      data?.company_name?.trim() ||
      extractCompanyFromTitle(tabTitle) ||
      extractCompanyFromUrl(portalUrl);
    const status = data?.status?.trim() || "applied";

    // Create application record
    const resp = await fetch(`${API_BASE_URL}/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({
        company_name: derivedCompanyName,
        role_title: derivedRoleTitle,
        portal_url: portalUrl,
        job_board: jobBoard,
        job_id: data?.job_id ?? null,
        resume_id: data?.resume_id ?? null,
        status,
      }),
    });

    if (!resp.ok) return { success: false, error: `Create application failed: HTTP ${resp.status}` };
    const application = await resp.json();

    const snapshot = {
      company_name: derivedCompanyName,
      role_title: derivedRoleTitle,
      portal_url: portalUrl,
      job_board: jobBoard,
      job_description: data?.job_description ?? null,
      salary: data?.salary ?? null,
      applied_at: data?.applied_at ?? new Date().toISOString(),
      status,
      supported_statuses: [
        "applied",
        "assessment",
        "interview_round_1",
        "interview_round_2",
        "interview_round_3",
        "rejected",
      ],
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

    const eventHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Session-Id": sessionId,
    };

    await fetch(`${API_BASE_URL}/applications/${application.id}/events`, {
      method: "POST",
      headers: eventHeaders,
      body: JSON.stringify({
        event_type: "autofill_complete",
        detail: `Auto-filled from Chrome extension at ${snapshot.applied_at}`,
      }),
    });

    await fetch(`${API_BASE_URL}/applications/${application.id}/events`, {
      method: "POST",
      headers: eventHeaders,
      body: JSON.stringify({
        event_type: "application_snapshot",
        detail: JSON.stringify(snapshot),
      }),
    });

    return { success: true, applicationId: application.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function detectJobBoard(url: string): string {
  if (!url) return "unknown";
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes("linkedin")) return "LinkedIn";
  if (hostname.includes("indeed")) return "Indeed";
  if (hostname.includes("glassdoor")) return "Glassdoor";
  if (hostname.includes("lever.co")) return "Lever";
  if (hostname.includes("greenhouse.io")) return "Greenhouse";
  if (hostname.includes("workday")) return "Workday";
  if (hostname.includes("icims")) return "iCIMS";
  if (hostname.includes("smartrecruiters")) return "SmartRecruiters";
  if (hostname.includes("jobvite")) return "Jobvite";
  if (hostname.includes("myworkdayjobs")) return "Workday";
  if (hostname.includes("taleo")) return "Taleo";
  if (hostname.includes("ashbyhq")) return "Ashby";
  return hostname;
}

function extractCompanyFromUrl(url: string): string {
  if (!url) return "";
  try {
    const hostname = new URL(url).hostname;
    // Remove common prefixes/suffixes
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
