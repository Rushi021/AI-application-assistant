/**
 * Background service worker for the Chrome extension.
 * Handles: side panel open, message routing, auth, session management, application tracking.
 */

import { MSG, STORAGE_KEYS } from "@/shared/constants";
import type { AutofillProgress, AutofillSession, UserProfile } from "@/shared/types";
import type { PendingApplication } from "@/shared/pending-application";
import { buildAutofillAnswersFromProfile } from "@/shared/autofill-answers";
import { enqueue } from "@/utils/pending-queue";
import {
  registerSyncAlarm,
  initSyncAlarmListener,
  syncPendingApplications,
} from "./sync";

// Allow content scripts to read/write chrome.storage.session (answers, trigger, decisions)
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

// Background sync: register alarm and listener on every service worker wake
registerSyncAlarm();
initSyncAlarmListener();

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

/** Multi-frame runs can emit "blocked" and "complete (0 fields)" in any order; last storage write must not drop an active upload gate. */
function mergeAutofillProgress(prev: AutofillProgress | null | undefined, incoming: AutofillProgress): AutofillProgress {
  if (incoming.state === "blocked" && incoming.activeBlocker) {
    return incoming;
  }
  if (
    prev?.state === "blocked" &&
    prev.activeBlocker &&
    incoming.state === "apply" &&
    (incoming.total ?? 0) === 0 &&
    (incoming.filled ?? 0) === 0
  ) {
    return prev;
  }
  if (
    prev?.state === "blocked" &&
    prev.activeBlocker &&
    incoming.state === "complete" &&
    (incoming.total ?? 0) === 0 &&
    (incoming.filled ?? 0) === 0 &&
    !incoming.activeBlocker
  ) {
    return prev;
  }
  return incoming;
}

async function persistMergedAutofillProgress(incoming: AutofillProgress): Promise<AutofillProgress> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.AUTOFILL_PROGRESS]);
  const prev = result[STORAGE_KEYS.AUTOFILL_PROGRESS] as AutofillProgress | undefined;
  const merged = mergeAutofillProgress(prev, incoming);
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_PROGRESS]: merged });
  return merged;
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

/** Deliver a message to every frame in the tab. */
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

    // Trigger autofill in the newly loaded page (content script is injected by manifest)
    chrome.tabs.sendMessage(tabId, { action: "run_autofill" }).catch(() => {});
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

  if (message.type === "PING") {
    sendResponse({ pong: true });
    return;
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
    const tabId = message.data?.tabId as number | undefined;
    if (typeof tabId !== "number") {
      sendResponse({ success: false, error: "Missing tabId" });
      return true;
    }
    chrome.tabs.sendMessage(tabId, { action: "run_autofill" }).catch(() => {});
    emitDiagTrace("DirectAutofill", "Forwarded run_autofill to tab");
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.BROADCAST_RUN_AUTOFILL) {
    const tabId = message.data?.tabId as number | undefined;
    if (typeof tabId !== "number") {
      sendResponse({ success: false, error: "Missing tabId" });
      return true;
    }
    chrome.tabs.sendMessage(tabId, { action: "run_autofill" }).catch(() => {});
    emitDiagTrace("BroadcastRunAutofill", "Forwarded run_autofill to tab");
    sendResponse({ success: true });
    return false;
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
    console.log("[BG-TRACK] received TRACK_APPLICATION message", message.data?.portal_url);
    (async () => {
      try {
        const data = message.data ?? {};
        const pendingApp: PendingApplication = {
          local_id: crypto.randomUUID(),
          portal_url: data.portal_url || "",
          company_name: data.company_name || null,
          role_title: data.role_title || null,
          job_board: data.job_board || null,
          applied_at: data.applied_at || new Date().toISOString(),
          status: "applied",
          job_id: data.job_id || null,
          resume_id: data.resume_id || null,
          resume_filename: data.resume_filename || null,
          resume_source: data.resume_source || null,
          cover_letter: data.cover_letter || null,
          salary: data.salary || null,
          synced: false,
          backend_id: null,
          retry_count: 0,
          last_error: null,
        };

        await enqueue(pendingApp);
        syncPendingApplications().catch(() => {});
        sendResponse({ success: true, local_id: pendingApp.local_id });
      } catch (err) {
        try {
          const { pending_applications = [] } =
            await chrome.storage.local.get("pending_applications");
          pending_applications.push({
            ...message.data,
            local_id: crypto.randomUUID(),
            synced: false,
            retry_count: 0,
            applied_at: new Date().toISOString(),
          });
          await chrome.storage.local.set({ pending_applications });
          sendResponse({ success: true });
        } catch (finalErr: unknown) {
          sendResponse({
            success: false,
            error: finalErr instanceof Error ? finalErr.message : String(finalErr),
          });
        }
      }
    })();
    return true;
  }

  if (message.type === MSG.AUTOFILL_DIAG_TRACE) {
    relayToExtensionViews(message);
    return false;
  }

  if (message.type === MSG.AUTOFILL_PROGRESS) {
    const data = (message as { data?: AutofillProgress }).data;
    if (!data || typeof data !== "object") {
      return false;
    }
    void persistMergedAutofillProgress(data)
      .then((merged) => {
        relayToExtensionViews({ type: MSG.AUTOFILL_PROGRESS, data: merged });
      })
      .catch(() => {});
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

    chrome.tabs.sendMessage(tab.id, { action: "run_autofill" }).catch(() => {});
    emitDiagTrace("StartAutofill", "Forwarded run_autofill to tab");
    emitStartResult(true);
  } catch (err) {
    emitStartResult(false, err instanceof Error ? err.message : "Failed to start auto-fill");
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  registerSyncAlarm();
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
