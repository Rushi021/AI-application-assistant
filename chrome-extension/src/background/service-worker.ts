/**
 * Background service worker for the Chrome extension.
 * Handles: side panel open on action click, message routing, auth state, application tracking.
 */

import { MSG, STORAGE_KEYS, API_BASE_URL } from "@/shared/constants";
import type { AutofillSession } from "@/shared/types";

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
  const session = await getAutofillSession();
  if (session?.tabId) {
    try {
      await chrome.tabs.sendMessage(session.tabId, { type: MSG.STOP_AUTOFILL });
    } catch {
      // Tab may already be closed
    }
  }
  await chrome.storage.session.remove([STORAGE_KEYS.AUTOFILL_SESSION]);
  relayToExtensionViews({
    type: MSG.AUTOFILL_SESSION_CANCEL,
    data: { reason: reason ?? "unknown" },
  });
  emitDiagTrace("Session", `Session cleared: ${reason ?? "unknown"}`);
}

type SessionRelayFrameResult = {
  href: string;
  isTop: boolean;
  result: {
    candidates: unknown[];
    results: Array<{
      action: string;
      canonicalKey: string | null;
    }>;
  };
};

type FrameProbeDiagnostic = {
  frameId: number;
  fieldCount: number;
  hasFormSignals: boolean;
  probeTimeMs: number;
  error?: string;
};

type FillAttemptDiagnostic = {
  frameId: number;
  filled: number;
  skipped: number;
  fillTimeMs: number;
};

type SequentialFrameAutofillResult = {
  total: number;
  filled: number;
  skipped: number;
  newFilledKeys: string[];
  framesScanned: number;
  scannedFrameIds: number[];
  frameId: number | null;
  href: string | null;
  isTop: boolean;
  result: SessionRelayFrameResult["result"] | null;
  reason?: "no_fields_found" | "frame_scan_limit";
  frameProbes: FrameProbeDiagnostic[];
  totalProbePhaseMs: number;
  fillAttempts: FillAttemptDiagnostic[];
};

/** Cheap pre-check budget before deciding whether a frame deserves a full autofill attempt. */
const FRAME_PREFLIGHT_TIMEOUT_MS = 1200;
/** Full autofill budget per attempted frame. */
const PER_FILL_ATTEMPT_MS = 6000;
/** Hard cap on ordered frame attempts to keep direct + continuation runs bounded. */
const MAX_FRAMES_TO_SCAN = 3;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function probeFrameLightweight(tabId: number, frameId: number): Promise<FrameProbeDiagnostic> {
  const t0 = Date.now();
  try {
    const exec = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: () => {
          const FORM_SIGNAL = /\b(name|email|phone|resume|experience|company|title|linkedin|address|work)\b/i;

          const isVisible = (el: HTMLElement): boolean => {
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          const getLabelText = (el: HTMLElement): string => {
            const withLabels = el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> };
            if (withLabels.labels && withLabels.labels.length > 0) {
              return Array.from(withLabels.labels)
                .map((l) => l.textContent?.trim() ?? "")
                .join(" ");
            }
            const aria = el.getAttribute("aria-label") ?? "";
            if (aria) return aria;
            if (el.id) {
              try {
                const fallback = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                if (fallback) return fallback.textContent?.trim() ?? "";
              } catch {
                const fb = document.querySelector(`label[for="${el.id.replace(/"/g, '\\"')}"]`);
                if (fb) return fb.textContent?.trim() ?? "";
              }
            }
            return "";
          };

          const controls = Array.from(
            document.querySelectorAll(
              'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea'
            )
          ).filter((el): el is HTMLElement => el instanceof HTMLElement && !(el as HTMLInputElement).disabled && isVisible(el));

          let hasFormSignals = false;
          for (const el of controls) {
            const hay = [
              el.getAttribute("name") ?? "",
              el.id ?? "",
              el.getAttribute("placeholder") ?? "",
              getLabelText(el),
            ]
              .join(" ")
              .toLowerCase();
            if (FORM_SIGNAL.test(hay)) {
              hasFormSignals = true;
              break;
            }
          }

          return { fieldCount: controls.length, hasFormSignals };
        },
      }),
      FRAME_PREFLIGHT_TIMEOUT_MS,
      `probe frameId=${frameId}`
    );
    const raw = exec[0]?.result as { fieldCount?: number; hasFormSignals?: boolean } | undefined;
    const probeTimeMs = Date.now() - t0;
    return {
      frameId,
      fieldCount: typeof raw?.fieldCount === "number" ? raw.fieldCount : 0,
      hasFormSignals: Boolean(raw?.hasFormSignals),
      probeTimeMs,
    };
  } catch (err) {
    const probeTimeMs = Date.now() - t0;
    return {
      frameId,
      fieldCount: 0,
      hasFormSignals: false,
      probeTimeMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function shouldAttemptFrameFill(
  probe: FrameProbeDiagnostic,
  frameIndex: number
): boolean {
  if (frameIndex === 0) return true;
  if (probe.error) return false;
  return probe.fieldCount > 0 || probe.hasFormSignals;
}

async function getCandidateFrames(tabId: number): Promise<Array<{ frameId: number; url: string }>> {
  const frames = await new Promise<chrome.webNavigation.GetAllFrameResultDetails[]>((resolve, reject) => {
    chrome.webNavigation.getAllFrames({ tabId }, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "getAllFrames failed"));
        return;
      }
      resolve(items ?? []);
    });
  });

  const filtered = frames.filter((frame) => {
    const url = frame.url ?? "";
    if (!url) return false;
    if (url === "about:blank") return false;
    if (url.startsWith("chrome-extension://")) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.frameId === 0 && b.frameId !== 0) return -1;
    if (b.frameId === 0 && a.frameId !== 0) return 1;
    return a.frameId - b.frameId;
  });

  return filtered.map((frame) => ({ frameId: frame.frameId, url: frame.url ?? "" }));
}

async function ensureDomRuntimeInjected(tabId: number): Promise<void> {
  let runtimeExistsInPrimaryFrame = false;
  try {
    const runtimeCheck = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => Boolean((window as Window & { __AI_DOM_CONTROL_ENGINE__?: unknown }).__AI_DOM_CONTROL_ENGINE__),
    });
    runtimeExistsInPrimaryFrame = Boolean(runtimeCheck[0]?.result);
  } catch {
    runtimeExistsInPrimaryFrame = false;
  }

  if (!runtimeExistsInPrimaryFrame) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/dom-runtime.js"],
    });
  }
}

async function runUnifiedAutofillForFrame(
  tabId: number,
  frameId: number,
  profile: Record<string, unknown>,
  allowRetryAfterInjection = true
): Promise<{
  frameId: number;
  href: string;
  isTop: boolean;
  result: SessionRelayFrameResult["result"];
}> {
  try {
    const exec = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      args: [profile],
      func: async (rawProfile) => {
        const engine = (window as Window & {
          __AI_DOM_CONTROL_ENGINE__?: {
            runUnifiedAutofill: (input: unknown) => Promise<{
              candidates: unknown[];
              results: Array<{ action: string; canonicalKey: string | null }>;
            }>;
          };
        }).__AI_DOM_CONTROL_ENGINE__;
        if (!engine) {
          throw new Error("DOM runtime not available in page context");
        }
        return {
          href: window.location.href,
          isTop: window === window.top,
          result: await engine.runUnifiedAutofill(rawProfile),
        };
      },
    });

    const value = exec[0]?.result as SessionRelayFrameResult | undefined;
    if (!value) {
      throw new Error(`No result returned for frameId=${frameId}`);
    }
    return { frameId, href: value.href, isTop: value.isTop, result: value.result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (allowRetryAfterInjection && /DOM runtime not available/i.test(msg)) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content/dom-runtime.js"],
      });
      return runUnifiedAutofillForFrame(tabId, frameId, profile, false);
    }
    throw err;
  }
}

async function hasResumeFieldInFrame(tabId: number, frameId: number): Promise<boolean> {
  const exec = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: () => {
      const resumePattern = /\b(resume|cv|upload)\b/i;
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, [role='heading']"));

      const isVisible = (el: HTMLElement): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const nearestHeadingText = (el: HTMLElement): string => {
        const elRect = el.getBoundingClientRect();
        let bestText = "";
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const heading of headings) {
          if (!(heading instanceof HTMLElement)) continue;
          const rect = heading.getBoundingClientRect();
          if (rect.bottom > elRect.top) continue;
          const distance = Math.abs(elRect.top - rect.bottom);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestText = heading.textContent?.trim() ?? "";
          }
        }
        return bestText;
      };

      const getLabelText = (input: HTMLInputElement): string => {
        const labels = input.labels ? Array.from(input.labels) : [];
        const explicit = labels.map((l) => l.textContent?.trim() ?? "").join(" ");
        if (explicit) return explicit;
        const aria = input.getAttribute("aria-label") ?? "";
        if (aria) return aria;
        if (input.id) {
          const fallback = document.querySelector(`label[for=\"${CSS.escape(input.id)}\"]`);
          if (fallback) return fallback.textContent?.trim() ?? "";
        }
        return "";
      };

      const inputs = Array.from(document.querySelectorAll("input[type='file']"))
        .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
        .filter((input) => !input.disabled)
        .filter((input) => isVisible(input));

      return inputs.some((input) => {
        const signal = [
          getLabelText(input),
          input.getAttribute("aria-label") ?? "",
          input.name ?? "",
          input.id ?? "",
          nearestHeadingText(input),
        ]
          .join(" ")
          .toLowerCase();
        return resumePattern.test(signal);
      });
    },
  });
  return Boolean(exec[0]?.result);
}

async function runUnifiedAutofillSequential(
  tabId: number,
  profile: Record<string, unknown>
): Promise<SequentialFrameAutofillResult> {
  await ensureDomRuntimeInjected(tabId);

  let frames: Array<{ frameId: number; url: string }> = [];
  try {
    frames = await getCandidateFrames(tabId);
  } catch (err) {
    emitDiagTrace(
      "FrameScan",
      `getAllFrames failed for tabId=${tabId}; fallback frame 0: ${err instanceof Error ? err.message : String(err)}`,
      "warn"
    );
    frames = [{ frameId: 0, url: "" }];
  }

  if (frames.length === 0) {
    frames = [{ frameId: 0, url: "" }];
  }

  const frameScanLimitExceeded = frames.length > MAX_FRAMES_TO_SCAN;
  const framesToProbe = frames.slice(0, MAX_FRAMES_TO_SCAN);
  if (frameScanLimitExceeded) {
    emitDiagTrace(
      "FrameScan",
      `Scanning first ${MAX_FRAMES_TO_SCAN} of ${frames.length} frames`,
      "warn"
    );
  }

  const frameProbes: FrameProbeDiagnostic[] = [];
  const fillAttempts: FillAttemptDiagnostic[] = [];
  const scannedFrameIds = framesToProbe.map((f) => f.frameId);
  const probePhaseStarted = Date.now();
  let lastFrameResult: Awaited<ReturnType<typeof runUnifiedAutofillForFrame>> | null = null;

  for (let i = 0; i < framesToProbe.length; i += 1) {
    const frame = framesToProbe[i];
    const probe = await probeFrameLightweight(tabId, frame.frameId);
    frameProbes.push(probe);
    emitDiagTrace(
      "FrameProbe",
      `frameId=${probe.frameId} fieldCount=${probe.fieldCount} hasFormSignals=${probe.hasFormSignals} probeTimeMs=${probe.probeTimeMs}${probe.error ? ` err=${probe.error}` : ""}`
    );

    if (!shouldAttemptFrameFill(probe, i)) {
      emitDiagTrace(
        "FrameScan",
        `Skipping frameId=${frame.frameId} after preflight`,
        "info"
      );
      continue;
    }

    const fillStarted = Date.now();
    try {
      const frameResult = await withTimeout(
        runUnifiedAutofillForFrame(tabId, frame.frameId, profile),
        PER_FILL_ATTEMPT_MS,
        `runUnifiedAutofill frameId=${frame.frameId}`
      );
      const fillTimeMs = Date.now() - fillStarted;
      const filled = frameResult.result.results.filter((item) => item.action === "filled").length;
      const skipped = frameResult.result.results.filter((item) => item.action.startsWith("skipped")).length;
      fillAttempts.push({ frameId: frame.frameId, filled, skipped, fillTimeMs });
      lastFrameResult = frameResult;

      const hasMeaningfulResult =
        filled > 0 ||
        frameResult.result.results.length > 0 ||
        frameResult.result.candidates.length > 0;

      emitDiagTrace(
        "FrameScan",
        `Attempt=${i + 1} frameId=${frame.frameId} filled=${filled} resultCount=${frameResult.result.results.length} fillTimeMs=${fillTimeMs}`
      );

      if (hasMeaningfulResult) {
        const totalProbePhaseMs = Date.now() - probePhaseStarted;
        const newFilledKeys = Array.from(
          new Set(
            frameResult.result.results
              .filter((item) => item.action === "filled" && typeof item.canonicalKey === "string")
              .map((item) => item.canonicalKey as string)
          )
        );
        return {
          total: frameResult.result.results.length,
          filled,
          skipped,
          newFilledKeys,
          framesScanned: frameProbes.length,
          scannedFrameIds,
          frameId: frameResult.frameId,
          href: frameResult.href,
          isTop: frameResult.isTop,
          result: frameResult.result,
          frameProbes,
          totalProbePhaseMs,
          fillAttempts,
        };
      }
    } catch (err) {
      const fillTimeMs = Date.now() - fillStarted;
      fillAttempts.push({ frameId: frame.frameId, filled: 0, skipped: 0, fillTimeMs });
      emitDiagTrace(
        "FrameScan",
        `Attempt=${i + 1} frameId=${frame.frameId} failed: ${err instanceof Error ? err.message : String(err)}`,
        "warn"
      );
    }
  }

  const totalProbePhaseMs = Date.now() - probePhaseStarted;
  emitDiagTrace("FrameScan", `Sequential scan complete totalProbePhaseMs=${totalProbePhaseMs} frames=${frameProbes.length}`);

  if (lastFrameResult) {
    const filled = lastFrameResult.result.results.filter((item) => item.action === "filled").length;
    const skipped = lastFrameResult.result.results.filter((item) => item.action.startsWith("skipped")).length;
    const newFilledKeys = Array.from(
      new Set(
        lastFrameResult.result.results
          .filter((item) => item.action === "filled" && typeof item.canonicalKey === "string")
          .map((item) => item.canonicalKey as string)
      )
    );
    return {
      total: lastFrameResult.result.results.length,
      filled,
      skipped,
      newFilledKeys,
      framesScanned: frameProbes.length,
      scannedFrameIds,
      frameId: lastFrameResult.frameId,
      href: lastFrameResult.href,
      isTop: lastFrameResult.isTop,
      result: lastFrameResult.result,
      reason: "no_fields_found",
      frameProbes,
      totalProbePhaseMs,
      fillAttempts,
    };
  }

  return {
    total: 0,
    filled: 0,
    skipped: 0,
    newFilledKeys: [],
    framesScanned: frameProbes.length,
    scannedFrameIds,
    frameId: null,
    href: null,
    isTop: false,
    result: null,
    reason: frameScanLimitExceeded ? "frame_scan_limit" : "no_fields_found",
    frameProbes,
    totalProbePhaseMs,
    fillAttempts,
  };
}

async function runSessionAutofillRelay(
  tabId: number,
  profile: Record<string, unknown>
): Promise<SequentialFrameAutofillResult> {
  return runUnifiedAutofillSequential(tabId, profile);
}

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
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content/content.js"],
      });
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

  // Multi-page session messages
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
        try {
          await chrome.tabs.sendMessage(tabId, { type: MSG.AUTOFILL_SESSION_STARTED });
        } catch {
          // Content script may not be ready yet
        }
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

  if (message.type === MSG.RUN_SESSION_AUTOFILL) {
    (async () => {
      try {
        const tabId = (sender.tab?.id as number | undefined) ?? (message.data?.tabId as number | undefined);
        if (typeof tabId !== "number") {
          sendResponse({ success: false, error: "Missing tabId" });
          return;
        }

        const session = await getAutofillSession();
        if (!session?.active || session.tabId !== tabId) {
          sendResponse({ success: false, error: "No active session for this tab" });
          return;
        }

        const profile = message.data?.profile as Record<string, unknown> | undefined;
        if (!profile || typeof profile !== "object") {
          sendResponse({ success: false, error: "Missing profile" });
          return;
        }

        const alreadyFilled = new Set(
          Array.isArray(message.data?.sessionFilledFieldTypes)
            ? (message.data.sessionFilledFieldTypes as string[])
            : session.filledFieldTypes
        );

        const relayResult = await runSessionAutofillRelay(tabId, profile);
        let uploadGateSkipReason: "no_resume_field_on_page" | "already_uploaded_this_session" | undefined;
        if (relayResult.frameId != null) {
          try {
            const hasResumeField = await hasResumeFieldInFrame(tabId, relayResult.frameId);
            if (!hasResumeField) {
              uploadGateSkipReason = "no_resume_field_on_page";
              emitDiagTrace(
                "SessionUploadGate",
                `skip_reason=${uploadGateSkipReason} frameId=${relayResult.frameId}`
              );
            } else if (session.resumeFileUploaded) {
              uploadGateSkipReason = "already_uploaded_this_session";
              emitDiagTrace(
                "SessionUploadGate",
                `skip_reason=${uploadGateSkipReason} frameId=${relayResult.frameId}`
              );
            }
          } catch (err) {
            emitDiagTrace(
              "SessionUploadGate",
              `Resume field preflight failed frameId=${relayResult.frameId}: ${err instanceof Error ? err.message : String(err)}`,
              "warn"
            );
          }
        }
        const dedupedNewFilledKeys = relayResult.newFilledKeys.filter((key) => !alreadyFilled.has(key));

        const mergedFilledTypes = new Set([...session.filledFieldTypes, ...dedupedNewFilledKeys]);
        const updated: AutofillSession = {
          ...session,
          filledFieldTypes: Array.from(mergedFilledTypes),
          totalFilledAcrossPages: session.totalFilledAcrossPages + relayResult.filled,
          totalSkippedAcrossPages: session.totalSkippedAcrossPages + relayResult.skipped,
        };
        await setAutofillSession(updated);

        emitDiagTrace(
          "Session",
          `Relay pass finished tabId=${tabId} total=${relayResult.total} filled=${relayResult.filled} skipped=${relayResult.skipped} framesScanned=${relayResult.framesScanned} newKeys=${dedupedNewFilledKeys.length}`
        );
        if (relayResult.reason === "no_fields_found") {
          emitDiagTrace(
            "Session",
            `No fields found during continuation scan tabId=${tabId} framesScanned=${relayResult.framesScanned}`,
            "warn"
          );
        }
        sendResponse({
          success: true,
          total: relayResult.total,
          filled: relayResult.filled,
          skipped: relayResult.skipped,
          newFilledKeys: dedupedNewFilledKeys,
          framesScanned: relayResult.framesScanned,
          scannedFrameIds: relayResult.scannedFrameIds,
          frameId: relayResult.frameId,
          reason: relayResult.reason,
          uploadGateSkipReason,
          frameProbes: relayResult.frameProbes,
          totalProbePhaseMs: relayResult.totalProbePhaseMs,
          fillAttempts: relayResult.fillAttempts,
        });
      } catch (err) {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
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
        const profile = message.data?.profile as Record<string, unknown> | undefined;
        if (!profile || typeof profile !== "object") {
          sendResponse({ success: false, error: "Missing profile" });
          return;
        }

        const result = await runUnifiedAutofillSequential(tabId, profile);
        if (result.reason === "no_fields_found") {
          emitDiagTrace(
            "DirectAutofill",
            `No fields found in frame scan tabId=${tabId} framesScanned=${result.framesScanned}`,
            "warn"
          );
        } else {
          emitDiagTrace(
            "DirectAutofill",
            `Direct pass finished tabId=${tabId} frameId=${result.frameId} total=${result.total} filled=${result.filled} skipped=${result.skipped} framesScanned=${result.framesScanned}`
          );
        }

        sendResponse({
          success: true,
          total: result.total,
          filled: result.filled,
          skipped: result.skipped,
          newFilledKeys: result.newFilledKeys,
          framesScanned: result.framesScanned,
          scannedFrameIds: result.scannedFrameIds,
          frameId: result.frameId,
          href: result.href,
          isTop: result.isTop,
          result: result.result,
          reason: result.reason,
          frameProbes: result.frameProbes,
          totalProbePhaseMs: result.totalProbePhaseMs,
          fillAttempts: result.fillAttempts,
        });
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
    clearAutofillSession("user_stopped").catch(() => {});
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
      if (firstResp.status !== 401) {
        return { response: firstResp, authExpired: false };
      }

      const refreshedAccessToken = await tryRefreshAccessToken();
      if (!refreshedAccessToken) {
        return { response: null, authExpired: true };
      }

      const retryHeaders = {
        ...(options.headers as Record<string, string>),
        Authorization: `Bearer ${refreshedAccessToken}`,
      };
      const retryResp = await fetch(url, { ...options, headers: retryHeaders });
      if (retryResp.status === 401) {
        return { response: null, authExpired: true };
      }
      return { response: retryResp, authExpired: false };
    };

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

    const buildAuthHeaders = (): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Session-Id": sessionId,
    });

    // Create application record
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
    const resp = createResult.response;

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
      const autofillEventResp = autofillEventResult.response;
      if (!autofillEventResp.ok) {
        eventsPartialFailure = true;
        console.error(
          `[TRACK_APPLICATION] Event write failed event_type=autofill_complete application_id=${application.id} status=${autofillEventResp.status}`
        );
      }
    } catch (err) {
      eventsPartialFailure = true;
      console.error(
        `[TRACK_APPLICATION] Event write failed event_type=autofill_complete application_id=${application.id} error=${err instanceof Error ? err.message : String(err)}`
      );
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
      const snapshotEventResp = snapshotEventResult.response;
      if (!snapshotEventResp.ok) {
        eventsPartialFailure = true;
        console.error(
          `[TRACK_APPLICATION] Event write failed event_type=application_snapshot application_id=${application.id} status=${snapshotEventResp.status}`
        );
      }
    } catch (err) {
      eventsPartialFailure = true;
      console.error(
        `[TRACK_APPLICATION] Event write failed event_type=application_snapshot application_id=${application.id} error=${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { success: true, applicationId: application.id, ...(eventsPartialFailure ? { eventsPartialFailure: true } : {}) };
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
