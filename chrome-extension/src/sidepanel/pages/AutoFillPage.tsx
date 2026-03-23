import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { deleteResume } from "../services/api";
import { MSG, STORAGE_KEYS } from "@/shared/constants";
import type { AutofillProgress, AutofillSession, FileUploadBlockerDecision, FormBlocker, UserProfile } from "@/shared/types";
import type {
  Phase1FillResult,
  UnifiedAutofillRunResult,
  UploadDetectorRunResult,
} from "@/shared/dom-control-engine";
import WorkflowLayout from "../components/WorkflowLayout";

const STATE_LABELS: Record<string, string> = {
  intake: "Reading form...",
  matching: "Matching fields...",
  preview: "Preview",
  apply: "Filling fields...",
  validate: "Checking validation...",
  navigate: "Navigating...",
  blocked: "Action required",
  complete: "Complete",
  stopped: "Stopped",
};

/**
 * After a fill pass completes: show "Done" only when there is no active multi-page session
 * (user must continue on further pages). If `sess.active === true`, always return false so the
 * UI stays on "waiting for next step", not "Done".
 * Short retries handle storage write lag after AUTOFILL_SESSION_STARTED.
 */
async function shouldMarkSessionCompleteAfterPass(): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await chrome.storage.session.get([STORAGE_KEYS.AUTOFILL_SESSION]);
      const sess = result[STORAGE_KEYS.AUTOFILL_SESSION] as AutofillSession | undefined;
      if (sess?.active) return false;
      if (sess && !sess.active) return true;
      if (!sess && attempt < 2) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const result = await chrome.storage.session.get([STORAGE_KEYS.AUTOFILL_SESSION]);
    const sess = result[STORAGE_KEYS.AUTOFILL_SESSION] as AutofillSession | undefined;
    return !sess?.active;
  } catch {
    return true;
  }
}

function getBlockerMessage(blocker: FormBlocker): string {
  switch (blocker.type) {
    case "file_upload":
      return blocker.subType === "resume"
        ? "Resume upload required"
        : blocker.subType === "cover_letter"
          ? "Cover letter upload required"
          : "File upload required";
    case "captcha":
      return "Complete the CAPTCHA on the page";
    case "otp":
      return "Enter the verification code";
    case "agreement":
      return `Agreement required: ${blocker.label}`;
    case "submit_confirmation":
      return "Confirm before submitting";
    default:
      return blocker.label;
  }
}

function hasRequiredProfile(p: UserProfile | null): boolean {
  if (!p) return false;
  const hasName =
    (p.full_name?.trim().length ?? 0) > 0 ||
    ((p as UserProfile & { first_name?: string }).first_name?.trim().length ?? 0) > 0;
  const hasLast =
    (p.full_name?.trim().split(/\s+/).length ?? 0) >= 2 ||
    ((p as UserProfile & { last_name?: string }).last_name?.trim().length ?? 0) > 0;
  const hasEmail = (p.email?.trim().length ?? 0) > 0;
  return hasName && hasLast && hasEmail;
}

function getUploadHeading(blocker: FormBlocker): string {
  if (blocker.type !== "file_upload") return "Action Required";
  if (blocker.subType === "resume") return "Upload Resume";
  if (blocker.subType === "cover_letter") return "Upload Cover Letter";
  return "Upload Document";
}

type TimelineLevel = "info" | "warn" | "error";

interface TimelineEvent {
  ts: number;
  level: TimelineLevel;
  message: string;
}

function formatTimelineTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function getPrimaryFrame<T extends { isTop: boolean }>(
  rows: T[],
  score: (row: T) => number
): T | null {
  return rows.reduce<T | null>((best, row) => {
    if (!best) return row;
    const bestScore = score(best);
    const rowScore = score(row);
    if (rowScore !== bestScore) return rowScore > bestScore ? row : best;
    return row.isTop && !best.isTop ? row : best;
  }, null);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

function isResumeSignal(text: string): boolean {
  return /\b(resume|cv|upload)\b/i.test(text);
}

export default function AutoFillPage() {
  const {
    autofillProgress,
    setAutofillProgress,
    draft,
    coverLetter,
    setPage,
    profile,
    autofillContext,
    setAutofillContext,
    resetWorkflow,
  } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [showUploadCompleteConfirm, setShowUploadCompleteConfirm] = useState(false);
  const [uploadedSameAsProfileResume, setUploadedSameAsProfileResume] = useState(false);
  type UploadDetectorFrameResult = {
    frameId: number;
    href: string;
    isTop: boolean;
    result: UploadDetectorRunResult;
  };
  type AutofillRunFrameResult = {
    frameId: number;
    href: string;
    isTop: boolean;
    result: UnifiedAutofillRunResult;
  };
  type FrameProbeRow = {
    frameId: number;
    fieldCount: number;
    hasFormSignals: boolean;
    probeTimeMs: number;
    error?: string;
  };
  type FillAttemptRow = { frameId: number; filled: number; skipped: number; fillTimeMs: number };
  type DirectAutofillRelayResponse = {
    success?: boolean;
    total?: number;
    filled?: number;
    skipped?: number;
    newFilledKeys?: string[];
    framesScanned?: number;
    scannedFrameIds?: number[];
    frameId?: number | null;
    href?: string | null;
    isTop?: boolean;
    result?: UnifiedAutofillRunResult | null;
    reason?: "no_fields_found" | "frame_scan_limit";
    frameProbes?: FrameProbeRow[];
    totalProbePhaseMs?: number;
    fillAttempts?: FillAttemptRow[];
    error?: string;
  };
  const [uploadDetectorResults, setUploadDetectorResults] = useState<Array<UploadDetectorFrameResult>>([]);
  const [autofillRunResults, setAutofillRunResults] = useState<Array<AutofillRunFrameResult>>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [profileFromStorage, setProfileFromStorage] = useState<UserProfile | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const previousProgressRef = useRef<AutofillProgress | null>(null);
  const handledUploadBlockerKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    chrome.storage.local.get(
      [STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.AUTOFILL_PROGRESS, STORAGE_KEYS.AUTOFILL_TRACE_LOG],
      (result) => {
        setProfileFromStorage((result[STORAGE_KEYS.USER_PROFILE] as UserProfile) ?? null);
        setAutofillProgress((result[STORAGE_KEYS.AUTOFILL_PROGRESS] as AutofillProgress) ?? null);
        const traceRows = Array.isArray(result[STORAGE_KEYS.AUTOFILL_TRACE_LOG])
          ? (result[STORAGE_KEYS.AUTOFILL_TRACE_LOG] as Array<{
              ts?: number;
              level?: TimelineLevel;
              step?: string;
              detail?: string;
              source?: string;
            }>)
          : [];
        if (traceRows.length > 0) {
          setTimeline(
            traceRows.slice(0, 20).map((row) => ({
              ts: row.ts ?? Date.now(),
              level: row.level ?? "info",
              message: `${row.source ? `[${row.source}] ` : ""}${row.step ?? "Trace"}: ${row.detail ?? ""}`.trim(),
            }))
          );
        }
      }
    );
    const storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[STORAGE_KEYS.USER_PROFILE]) {
        setProfileFromStorage((changes[STORAGE_KEYS.USER_PROFILE].newValue as UserProfile) ?? null);
      }
      if (changes[STORAGE_KEYS.AUTOFILL_PROGRESS]) {
        setAutofillProgress((changes[STORAGE_KEYS.AUTOFILL_PROGRESS].newValue as AutofillProgress) ?? null);
      }
      if (changes[STORAGE_KEYS.AUTOFILL_TRACE_LOG]) {
        const traceRows = Array.isArray(changes[STORAGE_KEYS.AUTOFILL_TRACE_LOG].newValue)
          ? (changes[STORAGE_KEYS.AUTOFILL_TRACE_LOG].newValue as Array<{
              ts?: number;
              level?: TimelineLevel;
              step?: string;
              detail?: string;
              source?: string;
            }>)
          : [];
        setTimeline(
          traceRows.slice(0, 20).map((row) => ({
            ts: row.ts ?? Date.now(),
            level: row.level ?? "info",
            message: `${row.source ? `[${row.source}] ` : ""}${row.step ?? "Trace"}: ${row.detail ?? ""}`.trim(),
          }))
        );
      }
    };
    chrome.storage.onChanged.addListener(storageListener);
    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, [setAutofillProgress]);

  useEffect(() => {
    chrome.storage.session.get([STORAGE_KEYS.AUTOFILL_SESSION]).then((result) => {
      const session = result[STORAGE_KEYS.AUTOFILL_SESSION] as AutofillSession | undefined;
      setSessionActive(!!session?.active);
    }).catch(() => setSessionActive(false));

    const sessionListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "session" && changes[STORAGE_KEYS.AUTOFILL_SESSION]) {
        const newVal = changes[STORAGE_KEYS.AUTOFILL_SESSION].newValue as AutofillSession | undefined;
        setSessionActive(!!newVal?.active);
      }
    };
    chrome.storage.onChanged.addListener(sessionListener);
    return () => chrome.storage.onChanged.removeListener(sessionListener);
  }, []);

  useEffect(() => {
    setShowUploadCompleteConfirm(false);
    setUploadedSameAsProfileResume(autofillContext.uploadedSameAsProfileResume);
  }, [autofillProgress?.activeBlocker?.selector, autofillContext.uploadedSameAsProfileResume]);

  useEffect(() => {
    if (!autofillProgress) {
      setStarted(false);
      return;
    }
    setStarted(!autofillProgress.completed);
  }, [autofillProgress]);

  const effectiveProfile = profile ?? profileFromStorage;
  const canRunAutofill = !!effectiveProfile;
  const hasCompleteProfile = hasRequiredProfile(effectiveProfile);
  const isDirectMode = autofillContext.mode === "direct";

  const appendTimeline = useCallback((message: string, level: TimelineLevel = "info") => {
    setTimeline((prev) => [{ ts: Date.now(), level, message }, ...prev].slice(0, 20));
  }, []);

  const resetExecutionView = useCallback(() => {
    setAutofillProgress(null);
    setTimeline([]);
    previousProgressRef.current = null;
    chrome.storage.local
      .remove([STORAGE_KEYS.AUTOFILL_PROGRESS, STORAGE_KEYS.AUTOFILL_TRACE_LOG])
      .catch(() => {});
  }, [setAutofillProgress]);

  useEffect(() => {
    const listener = (message: { type: string; data?: AutofillProgress | { step?: string; detail?: string; level?: TimelineLevel; source?: string; frameId?: number; reason?: string } | { ok?: boolean; error?: string | null; ts?: number } }) => {
      if (message.type === MSG.AUTOFILL_PROGRESS) {
        const next = message.data as AutofillProgress;
        const prev = previousProgressRef.current;
        if (!prev || prev.state !== next.state) {
          appendTimeline(`State: ${STATE_LABELS[next.state] ?? next.state}`);
        }
        if ((!prev?.activeBlocker && next.activeBlocker) || prev?.activeBlocker?.selector !== next.activeBlocker?.selector) {
          if (next.activeBlocker) {
            appendTimeline(`Blocked: ${getBlockerMessage(next.activeBlocker)}`, "warn");
          }
        }
        if ((prev?.validationErrors.length ?? 0) === 0 && next.validationErrors.length > 0) {
          appendTimeline(`Validation errors: ${next.validationErrors[0]?.message ?? "Please review page errors"}`, "warn");
        }
        if ((prev?.filled ?? 0) !== next.filled || (prev?.manual ?? 0) !== next.manual || (prev?.skipped ?? 0) !== next.skipped) {
          appendTimeline(
            `Progress: filled=${next.filled}, manual=${next.manual}, skipped=${next.skipped}${
              next.total > 0 ? `, total=${next.total}` : ""
            }`
          );
        }
        if (!prev?.completed && next.completed) {
          appendTimeline(
            next.state === "complete"
              ? "Autofill completed"
              : "Autofill stopped before completion",
            next.state === "complete" ? "info" : "warn"
          );
          setStarted(false);
        }
        if ((prev?.completed ?? false) && !next.completed) {
          setStarted(true);
        }
        previousProgressRef.current = next;
        setAutofillProgress(next);
      } else if (message.type === MSG.AUTOFILL_SESSION_CANCEL) {
        const reason = (message.data as { reason?: string } | undefined)?.reason;
        if (reason === "success_page" || reason === "success_url") {
          const prev = previousProgressRef.current;
          const next: AutofillProgress = {
            state: "complete",
            total: prev?.total ?? 0,
            filled: prev?.filled ?? 0,
            manual: prev?.manual ?? 0,
            skipped: prev?.skipped ?? 0,
            currentField: null,
            currentAction: null,
            paused: false,
            completed: true,
            sessionComplete: true,
            stepIndex: prev?.stepIndex ?? 0,
            fields: prev?.fields ?? [],
            activeBlocker: null,
            validationErrors: prev?.validationErrors ?? [],
            lastFilledField: prev?.lastFilledField ?? null,
          };
          previousProgressRef.current = next;
          setAutofillProgress(next);
          chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_PROGRESS]: next }).catch(() => {});
          setStarted(false);
          appendTimeline("Success page detected — session completed");
        }
      } else if (message.type === MSG.AUTOFILL_DIAG_TRACE) {
        const trace = message.data as { step?: string; detail?: string; level?: TimelineLevel; source?: string; frameId?: number } | undefined;
        if (trace) {
          const source = trace.source ? `[${trace.source}] ` : "";
          const frame = trace.frameId != null ? ` frame=${trace.frameId}` : "";
          appendTimeline(
            `${source}${trace.step ?? "Trace"}: ${trace.detail ?? ""}${frame}`.trim(),
            trace.level ?? "info"
          );
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [appendTimeline, setAutofillProgress]);

  const handleGenerateCoverLetterForBlocker = useCallback(() => {
    const blocker = useAppStore.getState().autofillProgress?.activeBlocker;
    if (!blocker || blocker.type !== "file_upload" || blocker.subType !== "cover_letter") {
      return;
    }
    setAutofillContext({
      pendingCoverLetterGeneration: true,
      pendingCoverLetterBlockerSelector: blocker.selector,
      pendingUploadSubtype: "cover_letter",
    });
    appendTimeline("Cover letter generation flow started");
    setPage("job-description");
  }, [appendTimeline, setAutofillContext, setPage]);

  const getActiveTab = useCallback(async (): Promise<{ id: number }> => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) throw new Error("No active tab found");
    const url = tab.url ?? "";
    if (["chrome:", "edge:", "about:", "chrome-extension:", "moz-extension:"].some((p) => url.startsWith(p))) {
      throw new Error("Cannot run handler tests on this page type");
    }
    return { id: tab.id };
  }, []);

  const ensureDomRuntime = useCallback(async (tabId: number) => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/dom-runtime.js"],
    });
  }, []);

  const hasResumeFileFieldInFrame = useCallback(
    async (tabId: number, frameId: number): Promise<boolean> => {
      const rows = await chrome.scripting.executeScript({
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
      return Boolean(rows[0]?.result);
    },
    []
  );

  const isResumeAlreadyUploadedInSession = useCallback(async (): Promise<boolean> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CHECK });
      const session = (response as { session?: AutofillSession })?.session;
      return Boolean(session?.active && session.resumeFileUploaded === true);
    } catch {
      return false;
    }
  }, []);

  const persistAutofillProgress = useCallback(
    async (progress: AutofillProgress | null) => {
      setAutofillProgress(progress);
      previousProgressRef.current = progress;
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_PROGRESS]: progress });
    },
    [setAutofillProgress]
  );

  const handleDoneAndStartNewApplication = useCallback(async () => {
    setError(null);
    chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "application_done" } }).catch(() => {});
    if (autofillProgress) {
      await persistAutofillProgress({
        ...autofillProgress,
        completed: true,
        sessionComplete: true,
        paused: false,
        currentField: null,
        currentAction: null,
        activeBlocker: null,
      });
    }
    appendTimeline("Finalizing application tracking");
    const store = useAppStore.getState();
    let trackingError: string | null = null;

    try {
      const selectedResume =
        store.resumes.find((resume) => resume.id === (store.autofillContext.temporaryResumeId ?? store.selectedResumeId)) ?? null;
      const resumeText =
        store.pipelineRun?.tailored_resume ??
        store.pipelineRun?.resume_text ??
        store.draft?.sections.map((section) => section.current_text).filter(Boolean).join("\n\n") ??
        null;
      const response = await chrome.runtime.sendMessage({
        type: "TRACK_APPLICATION",
        data: {
          job_id: store.jobId,
          resume_id: store.autofillContext.temporaryResumeId ?? store.selectedResumeId,
          job_description: store.jobDescription || store.draft?.job_description || store.pipelineRun?.job_description || null,
          salary:
            store.profile?.expected_salary ??
            store.profile?.current_salary ??
            null,
          applied_at: new Date().toISOString(),
          status: "applied",
          resume_filename: selectedResume?.original_filename ?? store.autofillContext.temporaryResumeFilename ?? null,
          resume_source: store.autofillContext.applicationResumeSource,
          resume_text: resumeText,
          cover_letter: store.coverLetter || store.draft?.cover_letter || store.pipelineRun?.cover_letter || null,
        },
      });

      if (!response?.success) {
        throw new Error(response?.error ?? "Failed to track application");
      }
      appendTimeline(`Application tracked id=${response.applicationId ?? "unknown"}`);
    } catch (err) {
      trackingError = err instanceof Error ? err.message : "Failed to finalize application";
      appendTimeline(`Tracking skipped: ${trackingError}`, "warn");
    }

    try {
      if (store.autofillContext.temporaryResumeId) {
        try {
          await deleteResume(store.autofillContext.temporaryResumeId);
        } catch {
          appendTimeline("Temporary resume cleanup failed", "warn");
        }
      }
    } finally {
      resetExecutionView();
      resetWorkflow();
      setStarted(false);
      setPage("job-description");
    }

    if (trackingError) {
      setError(`Started a new application, but tracking failed: ${trackingError}`);
    } else {
      appendTimeline("Workflow reset for next application");
    }
  }, [appendTimeline, autofillProgress, persistAutofillProgress, resetExecutionView, resetWorkflow, setPage]);

  const runDirectAutofillFlow = useCallback(async () => {
    if (!effectiveProfile) {
      throw new Error("No user profile found in extension storage");
    }

    appendTimeline("Direct autofill flow started");
    const { id: tabId } = await withTimeout(getActiveTab(), 5000, "Resolve active tab");

    appendTimeline("Running full deterministic autofill pass");
    const relay = await withTimeout(
      chrome.runtime.sendMessage({
        type: MSG.RUN_DIRECT_AUTOFILL,
        data: { tabId, profile: effectiveProfile },
      }) as Promise<DirectAutofillRelayResponse>,
      22000,
      "Direct autofill relay execution"
    );
    if (!relay?.success) {
      throw new Error(relay?.error ?? "Direct autofill relay failed");
    }

    if (relay.reason === "no_fields_found") {
      appendTimeline(
        `No fillable fields found after scanning ${relay.framesScanned ?? 0} frame(s)`,
        "warn"
      );
    } else if (relay.reason === "frame_scan_limit") {
      appendTimeline(
        `Autofill scan stopped after ${relay.framesScanned ?? 0} frame(s) (iframe limit); try the page’s main frame or fewer embedded frames`,
        "warn"
      );
    }

    const primaryResult: UnifiedAutofillRunResult = relay.result ?? {
      candidates: [],
      results: [],
      phase1Results: [],
      radioResults: [],
      checkboxResults: [],
      dropdownResults: [],
    };
    const primaryFrame: AutofillRunFrameResult | null =
      relay.frameId != null && relay.href
        ? {
            frameId: relay.frameId,
            href: relay.href,
            isTop: Boolean(relay.isTop),
            result: primaryResult,
          }
        : null;

    setAutofillRunResults(primaryFrame ? [primaryFrame] : []);
    const total = relay.total ?? primaryResult.results.length;
    const filled = relay.filled ?? primaryResult.results.filter((item) => item.action === "filled").length;
    const failed = primaryResult.results.filter((item) => item.action === "failed_write" || item.action === "failed_verify").length;
    const skipped = relay.skipped ?? primaryResult.results.filter((item) => item.action.startsWith("skipped")).length;
    const probeSummary =
      relay.frameProbes && relay.frameProbes.length > 0
        ? ` probePhase=${relay.totalProbePhaseMs ?? "?"}ms [${relay.frameProbes
            .map((p) => `f${p.frameId}:${p.probeTimeMs}ms${p.hasFormSignals ? "*" : ""}`)
            .join(", ")}]`
        : "";
    const fillSummary =
      relay.fillAttempts && relay.fillAttempts.length > 0
        ? ` fills=[${relay.fillAttempts.map((a) => `f${a.frameId}:${a.fillTimeMs}ms`).join(", ")}]`
        : "";
    appendTimeline(
      `Autofill pass finished: total=${total}, filled=${filled}, skipped=${skipped}, failed=${failed}, framesProbed=${relay.framesScanned ?? 0}${probeSummary}${fillSummary}`
    );

    const filledCanonicalKeys = (relay.newFilledKeys ?? []).filter((key): key is string => typeof key === "string");
    if (filledCanonicalKeys.length > 0) {
      chrome.runtime
        .sendMessage({
          type: MSG.AUTOFILL_SESSION_UPDATE,
          data: { newFilledFieldTypes: filledCanonicalKeys, filled, skipped },
        })
        .catch(() => {});
    }

    await withTimeout(ensureDomRuntime(tabId), 10000, "Inject DOM runtime");
    const detectorExec = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const engine = (window as Window & {
            __AI_DOM_CONTROL_ENGINE__?: { scanUploadDetectors: () => UploadDetectorRunResult };
          }).__AI_DOM_CONTROL_ENGINE__;
          if (!engine) {
            throw new Error("DOM runtime not available in page context");
          }
          return {
            href: window.location.href,
            isTop: window === window.top,
            result: engine.scanUploadDetectors(),
          };
        },
      }),
      10000,
      "Upload detector scan"
    );

    const detectorFrames = detectorExec
      .map((row) => {
        const value = row.result as Omit<UploadDetectorFrameResult, "frameId"> | undefined;
        if (!value) return null;
        return {
          frameId: row.frameId,
          href: value.href,
          isTop: value.isTop,
          result: value.result,
        } satisfies UploadDetectorFrameResult;
      })
      .filter((row): row is UploadDetectorFrameResult => row !== null)
      .sort((a, b) => Number(b.isTop) - Number(a.isTop));

    setUploadDetectorResults(detectorFrames);
    const primaryDetectorFrame = getPrimaryFrame(
      detectorFrames,
      (row) =>
        row.result.candidates.length * 100 +
        row.result.visibleFileInputs.length * 10 +
        row.result.hiddenFileInputs.length * 5 +
        row.result.visibleUploadTriggers.length
    );

    let nextBlocker = primaryDetectorFrame?.result.candidates.find((candidate) => {
      const key = `${candidate.selector}::${candidate.subType ?? "generic"}`;
      if (handledUploadBlockerKeysRef.current.has(key)) {
        return false;
      }

      const allInputs = [
        ...(primaryDetectorFrame?.result.visibleFileInputs ?? []),
        ...(primaryDetectorFrame?.result.hiddenFileInputs ?? []),
      ];
      const inputBySelector = new Map(allInputs.map((input) => [input.selector, input]));
      const directInput = inputBySelector.get(candidate.selector);
      if (directInput?.hasFiles) {
        return false;
      }

      // If any file input for this subtype already has files, treat the subtype as resolved.
      if (
        (candidate.subType === "resume" || candidate.subType === "cover_letter") &&
        allInputs.some((input) => {
          if (!input.hasFiles) return false;
          const signals = [input.label, input.name ?? "", input.id ?? "", ...(input.signals ?? [])]
            .join(" ")
            .toLowerCase();
          if (candidate.subType === "resume") {
            return /resume|cv|curriculum/.test(signals);
          }
          return /cover.?letter/.test(signals);
        })
      ) {
        return false;
      }

      return true;
    });

    if (nextBlocker?.subType === "resume" && primaryDetectorFrame?.frameId != null) {
      const hasResumeField = await hasResumeFileFieldInFrame(tabId, primaryDetectorFrame.frameId);
      if (!hasResumeField) {
        appendTimeline("Upload gate skipped: { skip_reason: 'no_resume_field_on_page' }");
        nextBlocker = undefined;
      } else {
        const alreadyUploaded = await isResumeAlreadyUploadedInSession();
        if (alreadyUploaded) {
          appendTimeline("Upload gate skipped: { skip_reason: 'already_uploaded_this_session' }");
          nextBlocker = undefined;
        }
      }
    }

    if (nextBlocker) {
      appendTimeline(`Upload blocker detected: ${nextBlocker.subType} selector=${nextBlocker.selector}`, "warn");
      await persistAutofillProgress({
        state: "blocked",
        total,
        filled,
        manual: 0,
        skipped,
        currentField: null,
        currentAction: null,
        paused: true,
        completed: false,
        sessionComplete: false,
        stepIndex: 0,
        fields: [],
        activeBlocker: {
          type: "file_upload",
          selector: nextBlocker.selector,
          label: nextBlocker.label,
          subType: nextBlocker.subType,
          resolved: false,
        },
        validationErrors: [],
        lastFilledField: null,
      });
      return;
    }

    const sessionComplete = await shouldMarkSessionCompleteAfterPass();

    if (total === 0) {
      appendTimeline("No supported fields were detected on this step", "warn");
      await persistAutofillProgress({
        state: "complete",
        total: 0,
        filled: 0,
        manual: 0,
        skipped: 0,
        currentField: null,
        currentAction: null,
        paused: false,
        completed: true,
        sessionComplete,
        stepIndex: 0,
        fields: [],
        activeBlocker: null,
        validationErrors: [],
        lastFilledField: null,
      });
      return;
    }

    await persistAutofillProgress({
      state: "complete",
      total,
      filled,
      manual: 0,
      skipped,
      currentField: null,
      currentAction: null,
      paused: false,
      completed: true,
      sessionComplete,
      stepIndex: 0,
      fields: [],
      activeBlocker: null,
      validationErrors: [],
      lastFilledField: null,
    });
  }, [
    appendTimeline,
    effectiveProfile,
    ensureDomRuntime,
    getActiveTab,
    hasResumeFileFieldInFrame,
    isResumeAlreadyUploadedInSession,
    persistAutofillProgress,
  ]);

  const handleStartAutofill = useCallback(async () => {
    setError(null);
    resetExecutionView();
    appendTimeline("Start requested");

    try {
      handledUploadBlockerKeysRef.current.clear();
      setStarted(true);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        void withTimeout(
          chrome.runtime.sendMessage({
            type: MSG.AUTOFILL_SESSION_STARTED,
            data: {
              tabId: tab.id,
              url: tab.url ?? "",
              suppressWorkAndSkills: autofillContext.suppressWorkAndSkills,
            },
          }),
          2500,
          "Session creation handshake"
        )
          .then((resp) => {
            if ((resp as { success?: boolean })?.success === false) {
              appendTimeline("Session create failed, continuing one-page autofill", "warn");
            } else {
              appendTimeline("Multi-page session ready — further pages will auto-fill");
            }
          })
          .catch(() => {
            appendTimeline("Session create timed out, continuing one-page autofill", "warn");
          });
      }

      await runDirectAutofillFlow();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start auto-fill");
      appendTimeline(err instanceof Error ? err.message : "Failed to start auto-fill", "error");
      setStarted(false);
    }
  }, [appendTimeline, autofillContext.suppressWorkAndSkills, resetExecutionView, runDirectAutofillFlow]);

  const handleStopAutofill = useCallback(() => {
    appendTimeline("Stop requested", "warn");
    chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "user_stop" } }).catch(() => {});
    handledUploadBlockerKeysRef.current.clear();
    void persistAutofillProgress({
      state: "stopped",
      total: autofillProgress?.total ?? 0,
      filled: autofillProgress?.filled ?? 0,
      manual: autofillProgress?.manual ?? 0,
      skipped: autofillProgress?.skipped ?? 0,
      currentField: null,
      currentAction: null,
      paused: false,
      completed: true,
      sessionComplete: true,
      stepIndex: autofillProgress?.stepIndex ?? 0,
      fields: autofillProgress?.fields ?? [],
      activeBlocker: null,
      validationErrors: [],
      lastFilledField: autofillProgress?.lastFilledField ?? null,
    }).catch(() => {});
    setStarted(false);
  }, [appendTimeline, autofillProgress, persistAutofillProgress]);

  const handleUndoAll = useCallback(() => {
    chrome.runtime.sendMessage({ type: MSG.AUTOFILL_UNDO_ALL }).catch(() => {});
  }, []);

  const handleFillAll = useCallback(() => {
    appendTimeline("Preview confirmed: Fill All");
    setStarted(true);
    runDirectAutofillFlow().catch((err) => {
      const msg = err instanceof Error ? err.message : "Failed to continue autofill";
      setError(msg);
      appendTimeline(msg, "error");
      setStarted(false);
    });
  }, [appendTimeline, runDirectAutofillFlow]);

  const sendUploadBlockerDecision = useCallback(
    async (decision: FileUploadBlockerDecision) => {
      const blocker = useAppStore.getState().autofillProgress?.activeBlocker;
      if (!blocker || blocker.type !== "file_upload") {
        throw new Error("No active upload blocker");
      }
      const selectorKey = `${blocker.selector}::${blocker.subType ?? "generic"}`;
      handledUploadBlockerKeysRef.current.add(selectorKey);
      appendTimeline(
        `Upload decision: ${decision} (${blocker.subType ?? "generic"})`,
        decision === "skipped_by_user" ? "warn" : "info"
      );
      if (blocker.subType === "resume" && decision === "resolved_by_user") {
        chrome.runtime
          .sendMessage({
            type: MSG.AUTOFILL_SESSION_UPDATE,
            data: { resumeFileUploaded: true },
          })
          .catch(() => {});
      }
      await persistAutofillProgress({
        state: "apply",
        total: autofillProgress?.total ?? 0,
        filled: autofillProgress?.filled ?? 0,
        manual: autofillProgress?.manual ?? 0,
        skipped: autofillProgress?.skipped ?? 0,
        currentField: null,
        currentAction: null,
        paused: false,
        completed: false,
        sessionComplete: false,
        stepIndex: autofillProgress?.stepIndex ?? 0,
        fields: autofillProgress?.fields ?? [],
        activeBlocker: null,
        validationErrors: [],
        lastFilledField: autofillProgress?.lastFilledField ?? null,
      });
      setStarted(true);
      await runDirectAutofillFlow();
      appendTimeline("Autofill resumed after upload blocker");
    },
    [appendTimeline, autofillProgress, persistAutofillProgress, runDirectAutofillFlow]
  );

  const handleMoveWithoutUpload = useCallback(async () => {
    try {
      const blocker = useAppStore.getState().autofillProgress?.activeBlocker;
      if (blocker?.type === "file_upload" && blocker.subType === "resume") {
        setAutofillContext({
          uploadedSameAsProfileResume: false,
          applicationResumeSource: null,
        });
      }
      await sendUploadBlockerDecision("skipped_by_user");
      setShowUploadCompleteConfirm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to skip upload blocker";
      setError(msg);
      appendTimeline(msg, "error");
    }
  }, [appendTimeline, sendUploadBlockerDecision, setAutofillContext]);

  const handleConfirmUploadCompleted = useCallback(async () => {
    try {
      const blocker = useAppStore.getState().autofillProgress?.activeBlocker;
      if (blocker?.type === "file_upload" && blocker.subType === "resume") {
        setAutofillContext({
          uploadedSameAsProfileResume,
          applicationResumeSource: uploadedSameAsProfileResume ? "profile_resume" : null,
        });
      }
      await sendUploadBlockerDecision("resolved_by_user");
      setShowUploadCompleteConfirm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resume after upload";
      setError(msg);
      appendTimeline(msg, "error");
    }
  }, [appendTimeline, sendUploadBlockerDecision, setAutofillContext, uploadedSameAsProfileResume]);

  const progress = autofillProgress;
  const isComplete = progress?.completed ?? false;
  const isSessionComplete = progress?.sessionComplete === true;
  const isPaused = progress?.paused ?? false;
  const state = progress?.state ?? "intake";
  const activeBlocker = progress?.activeBlocker ?? null;
  const validationErrors = progress?.validationErrors ?? [];
  const lastFilledField = progress?.lastFilledField ?? null;
  const primaryUploadDetectorResult = getPrimaryFrame(
    uploadDetectorResults,
    (row) =>
      row.result.candidates.length * 100 +
      row.result.visibleFileInputs.length * 10 +
      row.result.hiddenFileInputs.length * 5 +
      row.result.visibleUploadTriggers.length
  );
  const primaryAutofillResult = getPrimaryFrame(
    autofillRunResults,
    (row) =>
      row.result.results.filter((item) => item.action === "filled").length * 100 +
      row.result.results.length
  );

  return (
    <WorkflowLayout
      title="Auto-fill application"
      subtitle="Run on the employer's application page using your profile and saved materials."
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Summary */}
      <div className="px-4 py-2 space-y-2 shrink-0">
        <div className="bg-wf-surface border border-wf-border rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-wf-text">
              Resume: {isDirectMode ? (autofillContext.considerResume ? "Considered" : "Not considered") : draft ? "Ready" : "Not set"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-wf-text">
              Cover Letter: {isDirectMode ? "Not generated (no job description)" : coverLetter ? "Ready" : "Not set"}
            </span>
          </div>
          {isDirectMode && !autofillContext.hasStoredResume && (
            <p className="text-xs text-amber-400/90">
              No resume uploaded, please upload it on the application form.
            </p>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="flex-1 px-4 py-2 overflow-auto min-h-0">
        {!started && !progress && (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-[#1c1208] border-2 border-primary-900/50 rounded-full flex items-center justify-center text-2xl" aria-hidden>
              ⚡
            </div>
            <p className="text-sm font-medium text-wf-text">Ready to auto-fill</p>
            <p className="text-xs text-wf-muted mt-1">
              Make sure you&apos;re on the job application page,<br />then click the button below.
            </p>
            {canRunAutofill && !hasCompleteProfile && (
              <p className="text-xs text-amber-400/90 mt-2">
                Profile is partially complete. Auto-fill can run, but completion quality may be lower.
              </p>
            )}
            {!canRunAutofill && (
              <p className="text-xs text-amber-400/90 mt-2">
                Sign in and load your profile before starting auto-fill.
              </p>
            )}
          </div>
        )}

        {progress && (
          <div className="space-y-4">
            {/* State indicator */}
            <div className="text-xs font-medium text-wf-muted">
              {STATE_LABELS[state] ?? state}
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-wf-muted mb-1">
                <span>Progress</span>
                <span>
                  {progress.filled + progress.manual + progress.skipped}/{progress.total > 0 ? progress.total : "—"}
                </span>
              </div>
              <div className="w-full h-2 bg-wf-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isComplete ? "bg-green-500" : isPaused ? "bg-yellow-500" : "bg-primary-500"
                  }`}
                  style={{
                    width: `${
                      progress.total > 0
                        ? ((progress.filled + progress.manual + progress.skipped) / progress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Active blocker */}
            {activeBlocker && (
              <div className="bg-amber-950/35 border border-amber-900/50 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-xs font-medium text-amber-200">
                    {activeBlocker.type === "file_upload" ? getUploadHeading(activeBlocker) : getBlockerMessage(activeBlocker)}
                  </span>
                </div>
                <p className="text-xs text-amber-200/90 mt-1">{getBlockerMessage(activeBlocker)}</p>
                {activeBlocker.type === "file_upload" ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setShowUploadCompleteConfirm(true)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
                      >
                        Upload completed
                      </button>
                      <button
                        type="button"
                        onClick={handleMoveWithoutUpload}
                        className="px-3 py-1.5 text-xs font-medium text-wf-text border border-wf-border rounded-lg hover:bg-wf-surfaceHover transition-colors"
                      >
                        Move without upload
                      </button>
                      {activeBlocker.subType === "cover_letter" && (
                        <button
                          type="button"
                          onClick={handleGenerateCoverLetterForBlocker}
                          className="px-3 py-1.5 text-xs font-medium text-primary-400 border border-primary-800/50 rounded-lg hover:bg-primary-950/40 transition-colors"
                        >
                          Generate cover letter
                        </button>
                      )}
                    </div>
                    {showUploadCompleteConfirm && (
                      <div className="rounded-lg border border-wf-border bg-wf-surface p-2 space-y-2">
                        {activeBlocker.subType === "resume" && (
                          <label className="flex items-center gap-2 text-xs text-wf-text">
                            <input
                              type="checkbox"
                              checked={uploadedSameAsProfileResume}
                              onChange={(e) => setUploadedSameAsProfileResume(e.target.checked)}
                              className="rounded border-wf-border bg-wf-bg text-primary-500 focus:ring-primary-500/40"
                            />
                            I uploaded the same resume as my profile resume
                          </label>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleConfirmUploadCompleted}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
                          >
                            Continue
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowUploadCompleteConfirm(false)}
                            className="px-3 py-1.5 text-xs font-medium text-wf-text border border-wf-border rounded-lg hover:bg-wf-surfaceHover transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-200/80 mt-1">
                    Complete the action on the application page, then continue in the overlay.
                  </p>
                )}
              </div>
            )}

            {/* Validation errors */}
            {validationErrors.length > 0 && (
              <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-medium text-red-200">Validation errors</span>
                </div>
                <div className="text-xs text-red-200/90 mt-1 space-y-1">
                  {validationErrors.map((err, i) => (
                    <p key={i}>
                      {err.fieldLabel || err.fieldSelector ? (
                        <>Field: {err.fieldLabel || err.fieldSelector}{err.value != null && err.value !== "" ? ` (value: "${String(err.value).slice(0, 40)}${String(err.value).length > 40 ? "…" : ""}")` : ""} — {err.message}</>
                      ) : (
                        err.message
                      )}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Pre-fill preview */}
            {state === "preview" && progress.previewSummary && (
              <div className="bg-blue-950/40 border border-blue-900/50 rounded-xl p-3">
                <p className="text-xs font-medium text-blue-200">
                  Found {progress.previewSummary.total} fields. Will fill: {progress.previewSummary.willFill.slice(0, 6).join(", ")}
                  {progress.previewSummary.willFill.length > 6 ? "…" : ""}
                </p>
                <p className="text-xs text-blue-200/80 mt-1">
                  Unknown: {progress.previewSummary.unknownCount} fields. Click Fill all to proceed.
                </p>
              </div>
            )}

            {/* Paused - field manual */}
            {isPaused && !activeBlocker && state !== "preview" && (
              <div className="bg-yellow-950/30 border border-yellow-900/40 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-xs font-medium text-yellow-200">Paused — check the application page</span>
                </div>
                <p className="text-xs text-yellow-200/80 mt-1">
                  A field needs your attention. Fill it manually and use the page overlay to continue.
                </p>
              </div>
            )}

            {/* Complete */}
            {isComplete && (
              <div
                className={`border rounded-xl p-3 ${
                  !isSessionComplete && sessionActive
                    ? "bg-blue-950/35 border-blue-900/50"
                    : "bg-wf-tagGreen border-green-800/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {!isSessionComplete && sessionActive ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                      </span>
                      <span className="text-xs font-medium text-blue-200">Page complete — watching for next page</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs font-medium text-green-300">Auto-fill complete</span>
                    </>
                  )}
                </div>
                {isSessionComplete && (
                  <p className="text-xs text-green-200/80 mt-2">
                    Auto-tracking runs when you tap <span className="font-semibold">Done — track application</span> below — that
                    saves the entry to your account. Submit the employer&apos;s form in the tab first if you haven&apos;t already.
                  </p>
                )}
                {!isSessionComplete && sessionActive && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-xs text-blue-200/90 flex-1">
                      Navigate to the next page and auto-fill will continue automatically.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "user_cancel_panel" } }).catch(() => {});
                        await persistAutofillProgress({
                          state: "stopped",
                          total: progress?.total ?? 0,
                          filled: progress?.filled ?? 0,
                          manual: progress?.manual ?? 0,
                          skipped: progress?.skipped ?? 0,
                          currentField: null,
                          currentAction: null,
                          paused: false,
                          completed: true,
                          sessionComplete: true,
                          stepIndex: progress?.stepIndex ?? 0,
                          fields: progress?.fields ?? [],
                          activeBlocker: null,
                          validationErrors: progress?.validationErrors ?? [],
                          lastFilledField: progress?.lastFilledField ?? null,
                        });
                        setStarted(false);
                        appendTimeline("Multi-page session cancelled", "warn");
                      }}
                      className="px-2 py-1 text-[10px] font-medium text-red-400 border border-red-900/50 rounded-lg hover:bg-red-950/40 whitespace-nowrap"
                    >
                      End session
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Filled" value={progress.filled} color="text-green-400" bg="bg-wf-tagGreen" />
              <StatCard label="Manual" value={progress.manual} color="text-amber-400" bg="bg-amber-950/30" />
              <StatCard label="Skipped" value={progress.skipped} color="text-wf-muted" bg="bg-wf-surface" />
            </div>

            {/* Current field / action */}
            {progress.currentField && !isPaused && (
              <p className="text-xs text-wf-muted">
                Filling: <span className="font-medium text-wf-text">{progress.currentField}</span>
              </p>
            )}
            {progress.currentAction && !isPaused && (
              <p className="text-xs text-wf-muted">
                Action: <span className="font-medium text-wf-text">{progress.currentAction}</span>
              </p>
            )}

            {/* Last filled (for undo hint) */}
            {lastFilledField && !isComplete && (
              <p className="text-xs text-wf-muted">
                Last filled: {lastFilledField.label} — use overlay to undo if needed
              </p>
            )}
          </div>
        )}

        {uploadDetectorResults.length > 0 && primaryUploadDetectorResult && (
          <div className="mt-4 bg-wf-surface border border-wf-border rounded-xl p-3">
            <p className="text-xs font-semibold text-wf-text mb-2">Upload detector (debug)</p>
            <div className="space-y-2 text-xs text-wf-muted">
              <div key={`${primaryUploadDetectorResult.frameId}-${primaryUploadDetectorResult.href}`}>
                <p>
                  <span className="font-semibold text-indigo-700">
                    Frame {primaryUploadDetectorResult.frameId} {primaryUploadDetectorResult.isTop ? "(top)" : "(iframe)"}
                  </span>
                  {`: visibleInputs=${primaryUploadDetectorResult.result.visibleFileInputs.length}, hiddenInputs=${primaryUploadDetectorResult.result.hiddenFileInputs.length}, triggers=${primaryUploadDetectorResult.result.visibleUploadTriggers.length}, candidates=${primaryUploadDetectorResult.result.candidates.length}`}
                </p>
              </div>

              {primaryUploadDetectorResult.result.visibleFileInputs.slice(0, 5).map((item, idx) => (
                <p key={`ud-visible-${idx}`} className="text-wf-muted">
                  VISIBLE_FILE `{item.label}` selector=`{item.selector}` accept=`{item.accept ?? ""}` hasFiles={String(item.hasFiles)}
                </p>
              ))}

              {primaryUploadDetectorResult.result.hiddenFileInputs.slice(0, 5).map((item, idx) => (
                <p key={`ud-hidden-${idx}`} className="text-wf-muted">
                  HIDDEN_FILE `{item.label}` selector=`{item.selector}` accept=`{item.accept ?? ""}` signals={item.signals.slice(0, 3).join(" | ")}
                </p>
              ))}

              {primaryUploadDetectorResult.result.visibleUploadTriggers.slice(0, 6).map((item, idx) => (
                <p key={`ud-trigger-${idx}`} className="text-wf-muted">
                  TRIGGER [{item.tag}] `{item.text}` selector=`{item.selector}`
                </p>
              ))}

              {primaryUploadDetectorResult.result.candidates.length > 0 ? (
                primaryUploadDetectorResult.result.candidates.map((item, idx) => (
                  <p key={`ud-candidate-${idx}`} className="text-green-700">
                    CANDIDATE [{item.subType}] `{item.label}` via={item.source} selector=`{item.selector}` triggers={item.triggerTexts.join(" | ")}
                  </p>
                ))
              ) : (
                <p className="text-amber-700">No upload blocker candidates detected in the primary frame.</p>
              )}
            </div>
          </div>
        )}

        {autofillRunResults.length > 0 && primaryAutofillResult && (
          <div className="mt-4 bg-wf-surface border border-wf-border rounded-xl p-3">
            <p className="text-xs font-semibold text-wf-text mb-2">Autofill results (debug)</p>
            <div className="space-y-2 text-xs text-wf-muted">
              <div>
                <p>
                  <span className="font-semibold text-primary-700">
                    Frame {primaryAutofillResult.frameId} {primaryAutofillResult.isTop ? "(top)" : "(iframe)"}
                  </span>
                  {`: candidates=${primaryAutofillResult.result.candidates.length}, results=${primaryAutofillResult.result.results.length}`}
                </p>
                <p className="text-xs text-wf-dim">
                  summary: filled={primaryAutofillResult.result.results.filter((item) => item.action === "filled").length}, skipped={primaryAutofillResult.result.results.filter((item) => item.action.startsWith("skipped")).length}, failed={primaryAutofillResult.result.results.filter((item) => item.action === "failed_write" || item.action === "failed_verify").length}
                </p>
              </div>
              {primaryAutofillResult.result.results.map((item: Phase1FillResult, idx: number) => (
                <p
                  key={`autofill-${primaryAutofillResult.frameId}-${idx}`}
                  className={
                    item.action === "filled"
                      ? "text-green-700"
                      : item.action === "failed_write" || item.action === "failed_verify"
                        ? "text-red-700"
                        : "text-amber-700"
                  }
                >
                  {item.action.toUpperCase()} [{item.canonicalKey ?? "unmatched"}] {item.label} before="{item.before}" attempted="{item.attemptedValue ?? ""}" after="{item.after}" verified={String(item.verified)} ({item.reason})
                </p>
              ))}
            </div>
          </div>
        )}

        {timeline.length > 0 && (
          <div className="mt-4 bg-wf-surface border border-wf-border rounded-xl p-3">
            <p className="text-xs font-semibold text-wf-text mb-2">Execution timeline</p>
            <div className="space-y-1">
              {timeline.map((evt, idx) => (
                <p key={`${evt.ts}-${idx}`} className="text-xs text-wf-muted">
                  <span className="text-wf-dim">[{formatTimelineTime(evt.ts)}]</span>{" "}
                  <span
                    className={
                      evt.level === "error"
                        ? "text-red-700 font-semibold"
                        : evt.level === "warn"
                          ? "text-amber-700 font-semibold"
                          : "text-green-700 font-semibold"
                    }
                  >
                    {evt.level.toUpperCase()}
                  </span>{" "}
                  {evt.message}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-wf-border bg-wf-bg space-y-2 shrink-0">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage(isDirectMode ? "job-description" : "cover-letter")}
            className="px-4 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover shrink-0"
          >
            ← Back
          </button>
          {isSessionComplete ? (
            <button
              type="button"
              onClick={handleDoneAndStartNewApplication}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-[10px] hover:bg-green-700 transition-colors"
            >
              Done — track application ✓
            </button>
          ) : isComplete && sessionActive ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "user_cancel_panel" } }).catch(() => {});
                  await persistAutofillProgress({
                    state: "stopped",
                    total: progress?.total ?? 0,
                    filled: progress?.filled ?? 0,
                    manual: progress?.manual ?? 0,
                    skipped: progress?.skipped ?? 0,
                    currentField: null,
                    currentAction: null,
                    paused: false,
                    completed: true,
                    sessionComplete: true,
                    stepIndex: progress?.stepIndex ?? 0,
                    fields: progress?.fields ?? [],
                    activeBlocker: null,
                    validationErrors: progress?.validationErrors ?? [],
                    lastFilledField: progress?.lastFilledField ?? null,
                  });
                  setStarted(false);
                  appendTimeline("Multi-page session cancelled", "warn");
                }}
                className="px-4 py-2.5 text-sm text-red-400 border border-red-900/50 rounded-[10px] hover:bg-red-950/40"
              >
                End session
              </button>
              <button
                type="button"
                disabled
                className="flex-1 px-4 py-2.5 text-sm font-medium text-wf-dim bg-wf-surface border border-wf-border rounded-[10px] cursor-not-allowed"
              >
                Waiting for next step…
              </button>
            </>
          ) : (
            <>
              {started && (
                <>
                  <button
                    type="button"
                    onClick={handleUndoAll}
                    className="px-4 py-2.5 text-sm text-amber-400 border border-amber-900/40 rounded-[10px] hover:bg-amber-950/30"
                  >
                    Undo all
                  </button>
                  <button
                    type="button"
                    onClick={handleStopAutofill}
                    className="px-4 py-2.5 text-sm text-red-400 border border-red-900/50 rounded-[10px] hover:bg-red-950/40"
                  >
                    Stop
                  </button>
                </>
              )}
              {state === "preview" && isPaused ? (
                <button
                  type="button"
                  onClick={handleFillAll}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 transition-colors"
                >
                  Fill all
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartAutofill}
                  disabled={(!canRunAutofill) || (started && !isComplete)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-50 transition-colors"
                >
                  {started ? (isPaused ? "Waiting…" : "Filling…") : "Start auto-fill ⚡"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </WorkflowLayout>
  );
}

function StatCard({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={`${bg} border border-wf-border/80 rounded-lg p-2 text-center`}>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-wf-muted">{label}</p>
    </div>
  );
}
