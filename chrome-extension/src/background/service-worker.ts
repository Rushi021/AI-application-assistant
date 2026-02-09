/**
 * Background service worker for the Chrome extension.
 * Handles: side panel open on action click, message routing, auth state, application tracking.
 */

import { MSG, STORAGE_KEYS, API_BASE_URL } from "@/shared/constants";

// Open side panel when the extension action (icon) is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => console.error("sidePanel.setPanelBehavior error:", err));

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    // Forward to the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message, sendResponse);
      } else {
        sendResponse({ error: "No active tab" });
      }
    });
    return true;
  }

  // Track application after autofill completes
  if (message.type === "TRACK_APPLICATION") {
    trackApplication(message.data).then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  // Forward autofill progress to side panel (from content script)
  if (message.type === MSG.AUTOFILL_PROGRESS) {
    // Broadcast to all extension views (side panel will pick it up)
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }
});

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
}): Promise<{ success: boolean }> {
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
    const portalUrl = tab?.url ?? "";

    // Try to detect job board from URL
    const jobBoard = detectJobBoard(portalUrl);

    // Create application record
    const resp = await fetch(`${API_BASE_URL}/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({
        company_name: data?.company_name ?? extractCompanyFromUrl(portalUrl),
        role_title: data?.role_title ?? "",
        portal_url: portalUrl,
        job_board: jobBoard,
        job_id: data?.job_id ?? null,
        resume_id: data?.resume_id ?? null,
        status: "applied",
      }),
    });

    if (!resp.ok) return { success: false };
    const application = await resp.json();

    // Log autofill_complete event
    await fetch(`${API_BASE_URL}/applications/${application.id}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({
        event_type: "autofill_complete",
        detail: `Auto-filled from Chrome extension at ${new Date().toISOString()}`,
      }),
    });

    return { success: true };
  } catch {
    return { success: false };
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
