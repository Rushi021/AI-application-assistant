import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { deleteResume } from "../services/api";
import { MSG, STORAGE_KEYS } from "@/shared/constants";
import type { AutofillProgress, AutofillSession, FileUploadBlockerDecision, FormBlocker, UserProfile } from "@/shared/types";
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
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [profileFromStorage, setProfileFromStorage] = useState<UserProfile | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const previousProgressRef = useRef<AutofillProgress | null>(null);
  const handledUploadBlockerKeysRef = useRef<Set<string>>(new Set());
  const triggerResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    chrome.storage.local.get(
      [STORAGE_KEYS.USER_PROFILE, STORAGE_KEYS.AUTOFILL_PROGRESS],
      (result) => {
        setProfileFromStorage((result[STORAGE_KEYS.USER_PROFILE] as UserProfile) ?? null);
        setAutofillProgress((result[STORAGE_KEYS.AUTOFILL_PROGRESS] as AutofillProgress) ?? null);
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
    return () => {
      if (triggerResetTimerRef.current != null) {
        window.clearTimeout(triggerResetTimerRef.current);
      }
    };
  }, []);

  const effectiveProfile = profile ?? profileFromStorage;
  const canRunAutofill = !!effectiveProfile;
  const hasCompleteProfile = hasRequiredProfile(effectiveProfile);
  const isDirectMode = autofillContext.mode === "direct";

  const appendTimeline = useCallback((message: string, level: TimelineLevel = "info") => {
    setTimeline((prev) => [{ ts: Date.now(), level, message }, ...prev].slice(0, 20));
  }, []);

  const scheduleStartedReset = useCallback((delayMs = 2500) => {
    if (triggerResetTimerRef.current != null) {
      window.clearTimeout(triggerResetTimerRef.current);
    }
    triggerResetTimerRef.current = window.setTimeout(() => {
      setStarted(false);
      triggerResetTimerRef.current = null;
    }, delayMs);
  }, []);

  const resetExecutionView = useCallback(() => {
    setAutofillProgress(null);
    setTimeline([]);
    previousProgressRef.current = null;
    chrome.storage.local
      .remove([STORAGE_KEYS.AUTOFILL_PROGRESS])
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
      throw new Error("Cannot run auto-fill on this page type");
    }
    return { id: tab.id };
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

  const triggerAutofill = useCallback(async () => {
    if (!effectiveProfile) {
      throw new Error("No user profile found in extension storage");
    }

    const { id: tabId } = await getActiveTab();

    await chrome.storage.session.set({ [STORAGE_KEYS.AUTOFILL_TRIGGER_TS]: Date.now() });
    chrome.runtime
      .sendMessage({ type: MSG.BROADCAST_RUN_AUTOFILL, data: { tabId } })
      .catch(() => {});

    appendTimeline("Autofill trigger sent");
    scheduleStartedReset(2500);
  }, [
    appendTimeline,
    effectiveProfile,
    getActiveTab,
    scheduleStartedReset,
  ]);

  const handleStartAutofill = useCallback(async () => {
    setError(null);
    resetExecutionView();
    appendTimeline("Start requested");

    try {
      handledUploadBlockerKeysRef.current.clear();
      await chrome.storage.local.remove([STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS]);
      setStarted(true);
      await triggerAutofill();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start auto-fill");
      appendTimeline(err instanceof Error ? err.message : "Failed to start auto-fill", "error");
      setStarted(false);
    }
  }, [appendTimeline, resetExecutionView, triggerAutofill]);

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

  const sendUploadBlockerDecision = useCallback(
    async (decision: FileUploadBlockerDecision) => {
      const blocker = useAppStore.getState().autofillProgress?.activeBlocker;
      if (!blocker || blocker.type !== "file_upload") {
        throw new Error("No active upload blocker");
      }
      const selectorKey = `${blocker.selector}::${blocker.subType ?? "generic"}`;
      handledUploadBlockerKeysRef.current.add(selectorKey);
      const decisionsResult = await chrome.storage.local.get([STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS]);
      const decisions =
        (decisionsResult[STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS] as Record<
          string,
          { decision: FileUploadBlockerDecision; ts: number }
        > | undefined) ?? {};
      decisions[selectorKey] = { decision, ts: Date.now() };
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS]: decisions });
      chrome.runtime
        .sendMessage({
          type: MSG.AUTOFILL_UPLOAD_BLOCKER_DECISION,
          data: {
            selector: blocker.selector,
            subType: blocker.subType ?? "generic",
            decision,
          },
        })
        .catch(() => {});
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
      await triggerAutofill();
      appendTimeline("Autofill resumed after upload blocker");
    },
    [appendTimeline, autofillProgress, persistAutofillProgress, triggerAutofill]
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
                <button
                  type="button"
                  onClick={handleStopAutofill}
                  className="px-4 py-2.5 text-sm text-red-400 border border-red-900/50 rounded-[10px] hover:bg-red-950/40"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={handleStartAutofill}
                disabled={!canRunAutofill || started}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                {started ? "Filling…" : "Start auto-fill ⚡"}
              </button>
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
