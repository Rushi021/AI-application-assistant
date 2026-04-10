import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { deleteResume, submitTrackedApplication, type TrackApplicationPayload } from "../services/api";
import { MSG, STORAGE_KEYS } from "@/shared/constants";
import { getActiveTabContext } from "@/utils/tab-context";
import type { AutofillProgress, AutofillSession, FileUploadBlockerDecision, FormBlocker, UserProfile } from "@/shared/types";
import WorkflowLayout from "../components/WorkflowLayout";
import AccountMenu from "../components/AccountMenu";
import {
  WORKFLOW_STEPS,
  canNavigateToWorkflowStep,
  navigateToWorkflowStep,
  pageToWorkflowStepIndex,
  type WorkflowStepIndex,
} from "../workflowNavigation";

type FieldResultItem = {
  selector: string;
  label: string;
  action: "filled" | "skipped";
  reason: "filled" | "no_answer_match" | "fill_failed";
  answerKey?: string;
};

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

function BoltIcon({ size = 16, className = "text-primary-500" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M13 2L4.5 13.5H11L10 22L18.5 10.5H12L13 2Z" />
    </svg>
  );
}

function PulsingDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex w-2 h-2 shrink-0 ${className}`}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-500 opacity-40" />
      <span className="relative inline-flex rounded-full w-2 h-2 bg-primary-500" />
    </span>
  );
}

function AutofillStepRail() {
  const { currentPage, setPage, draft, autofillContext } = useAppStore();
  const stepIndex = pageToWorkflowStepIndex(currentPage);
  const isDirectMode = autofillContext.mode === "direct";
  if (stepIndex === null) return null;

  const handleStepClick = (i: number) => {
    if (!canNavigateToWorkflowStep(i, stepIndex, isDirectMode)) return;
    navigateToWorkflowStep(i as WorkflowStepIndex, { setPage, draft });
  };

  return (
    <div className="px-[18px] pt-4 bg-[#0a0a0a] shrink-0">
      <div className="flex items-center w-full">
        {WORKFLOW_STEPS.map((label, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          const skippedVisual = isDirectMode && i < 3 && stepIndex === 3;
          const navigable = canNavigateToWorkflowStep(i, stepIndex, isDirectMode);
          const lineDone = i < stepIndex && !isDirectMode;

          return (
            <div key={label} className={`flex items-center min-w-0 ${i < WORKFLOW_STEPS.length - 1 ? "flex-1" : ""}`}>
              <div className="flex flex-col items-center shrink-0">
                <button
                  type="button"
                  onClick={() => navigable && handleStepClick(i)}
                  disabled={!navigable}
                  title={
                    navigable
                      ? `Go back to ${label}`
                      : skippedVisual
                        ? "Skipped in direct autofill"
                        : undefined
                  }
                  className={[
                    "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors",
                    skippedVisual && !active
                      ? "bg-transparent border-2 border-transparent text-[#444444]"
                      : done
                        ? "bg-primary-500 border-2 border-primary-500 text-white"
                        : active
                          ? "bg-transparent border-2 border-primary-500 text-primary-500"
                          : "bg-transparent border-2 border-white/[0.12] text-[#444444]",
                  ].join(" ")}
                >
                  {skippedVisual && !active ? (
                    "—"
                  ) : done ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </button>
                <span
                  className={[
                    "mt-1 text-[10px] text-center max-w-[76px] leading-tight",
                    active ? "text-primary-500 font-bold" : "text-[#a0a0a0] font-medium",
                    navigable ? "cursor-pointer underline decoration-dotted underline-offset-2" : "",
                  ].join(" ")}
                  onClick={() => navigable && handleStepClick(i)}
                  role={navigable ? "button" : undefined}
                >
                  {label}
                </span>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <div
                  className={["h-[1.5px] flex-1 mx-1.5 mb-3.5 rounded-sm min-w-[6px]", lineDone ? "bg-primary-500" : "bg-white/[0.07]"].join(" ")}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
      {isDirectMode && stepIndex === 3 && (
        <p className="text-[10px] text-[#a0a0a0] mt-2 px-0.5 leading-snug">
          Direct autofill: tailoring steps were skipped. Use Back or finish and start a new application for the full workflow.
        </p>
      )}
    </div>
  );
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
    resumes,
    selectedResumeId,
    pipelineRun,
  } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<"idle" | "success" | "error">("idle");
  const [started, setStarted] = useState(false);
  const [showUploadCompleteConfirm, setShowUploadCompleteConfirm] = useState(false);
  const [uploadedSameAsProfileResume, setUploadedSameAsProfileResume] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [profileFromStorage, setProfileFromStorage] = useState<UserProfile | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const previousProgressRef = useRef<AutofillProgress | null>(null);
  const handledUploadBlockerKeysRef = useRef<Set<string>>(new Set());

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

  const effectiveProfile = profile ?? profileFromStorage;
  const canRunAutofill = !!effectiveProfile;
  const hasCompleteProfile = hasRequiredProfile(effectiveProfile);
  const isDirectMode = autofillContext.mode === "direct";

  const selectedResume = resumes.find((r) => r.id === (autofillContext.temporaryResumeId ?? selectedResumeId));
  const resumeName = isDirectMode
    ? autofillContext.considerResume
      ? "Considered"
      : "Not considered"
    : selectedResume?.original_filename ?? autofillContext.temporaryResumeFilename ?? (draft ? "Ready" : "Not set");
  const resumeSub = isDirectMode
    ? "Direct autofill mode"
    : pipelineRun?.tailored_resume || draft?.starting_source === "tailored"
      ? "AI tailored"
      : "Workflow mode";

  const appendTimeline = useCallback((message: string, level: TimelineLevel = "info") => {
    setTimeline((prev) => [{ ts: Date.now(), level, message }, ...prev].slice(0, 20));
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
    if (autofillProgress?.completed && autofillProgress.state !== "blocked") {
      setStarted(false);
    }
  }, [autofillProgress?.completed, autofillProgress?.state]);

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
    console.log("[TRACK] handler entered");
    setError(null);
    setTrackingStatus("idle");
    chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "application_done" } }).catch(() => {});
    if (autofillProgress) {
      console.log("[TRACK] about to persistAutofillProgress", { hasProgress: !!autofillProgress });
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
    console.log("[TRACK] persistAutofillProgress done");
    console.log("[TRACK] 3a: about to appendTimeline");
    appendTimeline("Finalizing application tracking");
    const store = useAppStore.getState();

    let trackPayload: TrackApplicationPayload | null = null;
    try {
      console.log("[TRACK] entered tracking try");
      console.log("[TRACK] 3b: about to getActiveTabContext");
      const tabContext = await getActiveTabContext();
      console.log("[TRACK] 3c: got tabContext", tabContext);
      const selectedResume =
        store.resumes.find((resume) => resume.id === (store.autofillContext.temporaryResumeId ?? store.selectedResumeId)) ?? null;

      trackPayload = {
        portal_url: tabContext.url,
        company_name: tabContext.company_name,
        role_title: tabContext.role_title,
        job_board: tabContext.job_board,
        applied_at: new Date().toISOString(),
        status: "applied",
        job_id: store.jobId || null,
        resume_id: store.autofillContext.temporaryResumeId ?? store.selectedResumeId ?? null,
        resume_filename: selectedResume?.original_filename ?? store.autofillContext.temporaryResumeFilename ?? null,
        resume_source: store.autofillContext.applicationResumeSource ?? null,
        cover_letter: store.coverLetter || store.draft?.cover_letter || store.pipelineRun?.cover_letter || null,
        salary: store.profile?.expected_salary ?? store.profile?.current_salary ?? null,
      };

      console.log("[TRACK] 3d: about to submitTrackedApplication (direct API)");
      const response = await submitTrackedApplication(trackPayload);
      console.log("[TRACK] API call succeeded", response);
      console.log("[TRACK] 3e: got response", response);
      setTrackingStatus("success");
      appendTimeline(`Application tracked (id=${response.id})`);
    } catch (err) {
      console.log("[TRACK] tracking try CAUGHT", err);
      if (trackPayload) {
        const pending = {
          local_id: crypto.randomUUID(),
          ...trackPayload,
          synced: false,
          backend_id: null,
          retry_count: 0,
          last_error: err instanceof Error ? err.message : String(err),
        };
        const { pending_applications = [] } = await chrome.storage.local.get("pending_applications");
        pending_applications.push(pending);
        await chrome.storage.local.set({ pending_applications });
        console.log("[TRACK] saved to pending queue for later sync");
        console.log("[TRACK] direct API failed, saved to pending queue");
        setTrackingStatus("error");
        appendTimeline("Tracking queued for later sync — will retry automatically", "warn");
      } else {
        setTrackingStatus("error");
        const msg = err instanceof Error ? err.message : "Unknown error";
        appendTimeline(`Tracking error: ${msg} — will retry automatically`, "warn");
      }
    }

    // Let the user see the success/error banner before resetting
    console.log("[TRACK] about to delay");
    await new Promise((r) => setTimeout(r, 1500));

    try {
      console.log("[TRACK] entered cleanup try");
      if (store.autofillContext.temporaryResumeId) {
        try {
          await deleteResume(store.autofillContext.temporaryResumeId);
        } catch {
          appendTimeline("Temporary resume cleanup failed", "warn");
        }
      }
    } finally {
      console.log("[TRACK] finally — navigating to job-description");
      resetExecutionView();
      resetWorkflow();
      setStarted(false);
      setTrackingStatus("idle");
      setPage("job-description");
    }
  }, [appendTimeline, autofillProgress, persistAutofillProgress, resetExecutionView, resetWorkflow, setPage]);

  const triggerAutofill = useCallback(async () => {
    if (!effectiveProfile) {
      throw new Error("No user profile found in extension storage");
    }

    const { id: tabId } = await getActiveTab();

    await chrome.storage.session.set({ [STORAGE_KEYS.AUTOFILL_TRIGGER_TS]: Date.now() });
    chrome.tabs.sendMessage(tabId, { action: "run_autofill" }).catch(() => {});

    appendTimeline("Autofill trigger sent");
  }, [appendTimeline, effectiveProfile, getActiveTab]);

  const handleStartAutofill = useCallback(async () => {
    setError(null);
    resetExecutionView();
    appendTimeline("Start requested");

    try {
      handledUploadBlockerKeysRef.current.clear();
      await chrome.storage.local.remove([STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS]);
      setStarted(true);

      const { id: tabId } = await getActiveTab();
      const tabContext = await getActiveTabContext();
      chrome.runtime
        .sendMessage({
          type: MSG.AUTOFILL_SESSION_STARTED,
          data: { tabId, url: tabContext.url },
        })
        .catch(() => {});

      await triggerAutofill();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start auto-fill");
      appendTimeline(err instanceof Error ? err.message : "Failed to start auto-fill", "error");
      setStarted(false);
    }
  }, [appendTimeline, getActiveTab, resetExecutionView, triggerAutofill]);

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
  const fieldResults = (progress?.fields ?? []) as unknown as FieldResultItem[];
  const filledFieldResults = fieldResults.filter((f) => f && f.action === "filled");
  const skippedFieldResults = fieldResults.filter((f) => f && f.action === "skipped");

  const pageStatusMessage =
    !started && !progress
      ? "Navigate to the job application page, then tap Start."
      : started && !progress
        ? "Filling the current page. Waiting for status from the application tab..."
        : activeBlocker
          ? getBlockerMessage(activeBlocker)
          : isComplete && sessionActive
            ? "Page complete. Navigate to the next page - auto-fill will continue automatically."
            : isSessionComplete
              ? "All pages complete. Submit the employer form, then tap Done below."
              : `Current step: ${STATE_LABELS[state] ?? state}`;

  const pctNumeric =
    progress && progress.total > 0
      ? Math.round(((progress.filled + progress.manual + progress.skipped) / progress.total) * 100)
      : isComplete
        ? 100
        : 0;

  const progressBarWidthPct =
    started && !progress
      ? 0
      : progress && progress.total > 0
        ? ((progress.filled + progress.manual + progress.skipped) / progress.total) * 100
        : isComplete
          ? 100
          : 0;

  const showIdleHero = !started && !progress;
  const pageNumForComplete = (progress?.stepIndex ?? 0) + 1;
  const coverReady = !isDirectMode && !!coverLetter;

  const endMultiPageSession = async () => {
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
  };

  return (
    <WorkflowLayout hideHeader hideTitleSection showWorkflowChrome={false} title="">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#0a0a0a] text-[#f5f5f5] font-sans antialiased">
        <div className="shrink-0 flex items-center justify-between gap-3 px-[18px] py-[13px] border-b border-white/[0.07] bg-[#111111]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-[22px] h-[22px] rounded-md bg-primary-500 flex items-center justify-center shrink-0">
              <BoltIcon size={12} className="text-white" />
            </div>
            <span className="text-sm font-bold text-[#f5f5f5] truncate">AI Job Assistant</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <AccountMenu />
            <div className="flex items-center gap-3.5 text-[#444444]" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Location</title>
              <path d="M12 2a5 5 0 0 1 5 5c0 5-5 11-5 11S7 12 7 7a5 5 0 0 1 5-5z" />
            </svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Close</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            </div>
          </div>
        </div>

        <AutofillStepRail />

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 px-[18px] py-5 overflow-auto min-h-0 flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-bold text-[#f5f5f5] m-0 tracking-tight leading-tight">Auto-fill application</h2>
              <p className="text-[13px] text-[#a0a0a0] mt-1.5 m-0 leading-relaxed">{pageStatusMessage}</p>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 rounded-[10px] border border-white/[0.07] bg-[#161616] px-3 py-2.5">
                <div className="text-[10px] font-bold text-[#22c55e] tracking-[0.08em] mb-0.5">RESUME</div>
                <div className="text-xs font-semibold text-[#f5f5f5]">{resumeName}</div>
                <div className="text-[11px] text-[#a0a0a0] mt-0.5">{resumeSub}</div>
              </div>
              <div className="flex-1 rounded-[10px] border border-white/[0.07] bg-[#161616] px-3 py-2.5">
                <div
                  className={`text-[10px] font-bold tracking-[0.08em] mb-0.5 ${coverReady ? "text-[#22c55e]" : "text-[#444444]"}`}
                >
                  COVER LETTER
                </div>
                <div className={`text-xs ${coverReady ? "font-semibold text-[#f5f5f5]" : "text-[#a0a0a0]"}`}>
                  {isDirectMode ? "Not generated" : coverLetter ? "Ready" : "Not generated"}
                </div>
                <div className={`text-[11px] mt-0.5 ${coverReady ? "text-[#a0a0a0]" : "text-[#444444]"}`}>
                  {isDirectMode ? "No JD provided" : "Based on workflow input"}
                </div>
              </div>
            </div>
            {showIdleHero && (
              <div className="rounded-[14px] border border-white/[0.07] bg-[#161616] px-5 py-7 text-center">
                <div className="w-[54px] h-[54px] mx-auto mb-3.5 rounded-full bg-[rgba(249,115,22,0.08)] border-[1.5px] border-primary-500/25 flex items-center justify-center">
                  <BoltIcon size={24} className="text-primary-500" />
                </div>
                <div className="text-[15px] font-bold text-[#f5f5f5] mb-1">Ready to auto-fill</div>
                <div className="text-xs text-[#a0a0a0] leading-relaxed">
                  Make sure you&apos;re on the job application
                  <br />
                  page before starting.
                </div>
                {canRunAutofill && !hasCompleteProfile && (
                  <p className="text-xs text-amber-500/95 mt-3">Profile is partially complete. Auto-fill can run, but completion quality may be lower.</p>
                )}
                {!canRunAutofill && (
                  <p className="text-xs text-amber-500/95 mt-3">Sign in and load your profile before starting auto-fill.</p>
                )}
              </div>
            )}

            {started && !progress && (
              <div className="rounded-[14px] border border-white/[0.07] bg-[#161616] px-4 py-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 min-w-0 text-[13px]">
                    <PulsingDot />
                    <span className="text-[#a0a0a0] truncate">Waiting for autofill status…</span>
                  </div>
                  <span className="text-[15px] font-extrabold text-primary-500 shrink-0">0%</span>
                </div>
                <div className="h-[7px] rounded-md bg-[#1c1c1c] overflow-hidden mb-3">
                  <div className="h-full w-0 rounded-md bg-primary-500 transition-[width] duration-150" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-[9px] border border-white/[0.07] bg-[#1c1c1c] py-2 text-center">
                    <div className="text-lg font-extrabold text-[#22c55e] leading-none">0</div>
                    <div className="text-[10px] text-[#a0a0a0] mt-1 font-medium">Filled</div>
                  </div>
                  <div className="flex-1 rounded-[9px] border border-white/[0.07] bg-[#1c1c1c] py-2 text-center">
                    <div className="text-lg font-extrabold text-amber-500 leading-none">0</div>
                    <div className="text-[10px] text-[#a0a0a0] mt-1 font-medium">Manual</div>
                  </div>
                  <div className="flex-1 rounded-[9px] border border-white/[0.07] bg-[#1c1c1c] py-2 text-center">
                    <div className="text-lg font-extrabold text-[#444444] leading-none">0</div>
                    <div className="text-[10px] text-[#a0a0a0] mt-1 font-medium">Skipped</div>
                  </div>
                </div>
                <p className="text-[11px] text-[#a0a0a0] mt-3 leading-relaxed">
                  Talking to the application tab. If this stays here, refresh the page and try again.
                </p>
              </div>
            )}

            {progress && (
              <div className="space-y-4">
                <div className="rounded-[14px] border border-white/[0.07] bg-[#161616] px-4 py-4">
                  <div className="flex items-center justify-between mb-2.5 gap-2">
                    <div className="flex items-center gap-2 min-w-0 text-[13px]">
                      {activeBlocker ? (
                        <span className="text-[#a0a0a0] truncate">{getBlockerMessage(activeBlocker)}</span>
                      ) : isComplete && state === "stopped" ? (
                        <span className="text-amber-500 font-semibold">Stopped</span>
                      ) : isComplete && sessionActive && !isSessionComplete ? (
                        <span className="text-[#22c55e] font-semibold">✓ Page {pageNumForComplete} complete</span>
                      ) : isSessionComplete ? (
                        <span className="text-[#22c55e] font-semibold">✓ All pages complete</span>
                      ) : (
                        <>
                          <PulsingDot />
                          <span className="text-[#a0a0a0] truncate">{STATE_LABELS[state] ?? state}</span>
                        </>
                      )}
                    </div>
                    <span
                      className={`text-[15px] font-extrabold shrink-0 ${isSessionComplete ? "text-[#22c55e]" : "text-primary-500"}`}
                    >
                      {pctNumeric}%
                    </span>
                  </div>
                  <div className="h-[7px] rounded-md bg-[#1c1c1c] overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-md transition-[width] duration-150 ${
                        isSessionComplete ? "bg-[#22c55e]" : isPaused ? "bg-amber-500" : "bg-primary-500"
                      }`}
                      style={{ width: `${progressBarWidthPct}%` }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-[9px] border border-white/[0.07] bg-[#1c1c1c] py-2 text-center">
                      <div className="text-lg font-extrabold text-[#22c55e] leading-none">{progress.filled}</div>
                      <div className="text-[10px] text-[#a0a0a0] mt-1 font-medium">Filled</div>
                    </div>
                    <div className="flex-1 rounded-[9px] border border-white/[0.07] bg-[#1c1c1c] py-2 text-center">
                      <div className="text-lg font-extrabold text-amber-500 leading-none">{progress.manual}</div>
                      <div className="text-[10px] text-[#a0a0a0] mt-1 font-medium">Manual</div>
                    </div>
                    <div className="flex-1 rounded-[9px] border border-white/[0.07] bg-[#1c1c1c] py-2 text-center">
                      <div className="text-lg font-extrabold text-[#444444] leading-none">{progress.skipped}</div>
                      <div className="text-[10px] text-[#a0a0a0] mt-1 font-medium">Skipped</div>
                    </div>
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

            {isSessionComplete && (
              <div className="rounded-xl border border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.08)] px-3.5 py-3 flex gap-2.5 items-start">
                <svg
                  className="w-[15px] h-[15px] text-[#22c55e] shrink-0 mt-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                <div>
                  <div className="text-xs font-semibold text-[#22c55e] mb-1">Submit the employer&apos;s form</div>
                  <p className="text-xs text-[#a0a0a0] leading-relaxed m-0">
                    Review any fields marked <strong className="text-amber-500 font-semibold">Manual</strong>, then submit on the employer&apos;s site. Tap{" "}
                    <strong className="text-[#f5f5f5] font-semibold">Done — track application</strong> below to save this application to your tracker.
                  </p>
                </div>
              </div>
            )}

            {isComplete && sessionActive && !isSessionComplete && (
              <div className="rounded-xl border border-amber-500/20 bg-[rgba(245,158,11,0.08)] px-3.5 py-3 flex gap-2.5 items-start">
                <svg
                  className="w-[15px] h-[15px] text-amber-500 shrink-0 mt-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-amber-500 mb-1">Continue to next page</div>
                  <p className="text-xs text-[#a0a0a0] leading-relaxed m-0">
                    Click <strong className="text-[#f5f5f5] font-semibold">Next</strong> on the employer&apos;s form. Auto-fill will detect the new page and continue filling automatically.
                  </p>
                  <button
                    type="button"
                    onClick={() => void endMultiPageSession()}
                    className="mt-2 text-[11px] font-medium text-red-400/95 hover:text-red-300 underline decoration-dotted underline-offset-2"
                  >
                    End multi-page session
                  </button>
                </div>
              </div>
            )}

            {/* Details (user-facing) */}
            {(skippedFieldResults.length > 0 || filledFieldResults.length > 0 || validationErrors.length > 0 || timeline.length > 0) && (
              <div className="bg-wf-surface border border-wf-border rounded-xl p-3">
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-wf-text"
                >
                  <span>Details</span>
                  <span className="text-wf-muted">{showDetails ? "Hide" : "Show"}</span>
                </button>

                {showDetails && (
                  <div className="mt-3 space-y-3">
                    {skippedFieldResults.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-wf-text">
                          Skipped fields <span className="text-wf-muted">({skippedFieldResults.length})</span>
                        </p>
                        <div className="mt-2 space-y-1">
                          {skippedFieldResults.slice(0, 12).map((f) => (
                            <div key={f.selector} className="text-xs text-wf-muted flex items-start justify-between gap-2">
                              <span className="truncate">
                                <span className="text-wf-text">{f.label || f.selector}</span>
                                {f.reason === "no_answer_match" ? (
                                  <span className="text-wf-dim"> — no matching answer</span>
                                ) : (
                                  <span className="text-wf-dim"> — could not fill</span>
                                )}
                              </span>
                              <span className="text-wf-dim shrink-0">{f.reason === "no_answer_match" ? "no-match" : "failed"}</span>
                            </div>
                          ))}
                          {skippedFieldResults.length > 12 && (
                            <p className="text-[11px] text-wf-dim mt-1">Showing 12 of {skippedFieldResults.length} skipped fields.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {filledFieldResults.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-wf-text">
                          Filled fields <span className="text-wf-muted">({filledFieldResults.length})</span>
                        </p>
                        <div className="mt-2 space-y-1">
                          {filledFieldResults.slice(0, 8).map((f) => (
                            <div key={f.selector} className="text-xs text-wf-muted truncate">
                              <span className="text-wf-text">{f.label || f.selector}</span>
                              {f.answerKey ? <span className="text-wf-dim"> — {f.answerKey}</span> : null}
                            </div>
                          ))}
                          {filledFieldResults.length > 8 && (
                            <p className="text-[11px] text-wf-dim mt-1">Showing 8 of {filledFieldResults.length} filled fields.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Keep validation errors visible here too */}
                    {validationErrors.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-wf-text">
                          Validation errors <span className="text-wf-muted">({validationErrors.length})</span>
                        </p>
                        <div className="mt-2 space-y-1">
                          {validationErrors.slice(0, 6).map((err, i) => (
                            <p key={i} className="text-xs text-red-300/90">
                              {err.fieldLabel || err.fieldSelector ? `Field: ${err.fieldLabel || err.fieldSelector} — ${err.message}` : err.message}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Developer timeline moved under details */}
                    {timeline.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-wf-text">Execution timeline</p>
                        <div className="mt-2 space-y-1">
                          {timeline.slice(0, 8).map((evt, idx) => (
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
                          {timeline.length > 8 && <p className="text-[11px] text-wf-dim mt-1">Showing 8 of {timeline.length} events.</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

          </div>

          <div className="shrink-0 px-[18px] py-3 border-t border-white/[0.07] bg-[#0a0a0a] space-y-2">
            {error && <p className="text-xs text-red-400">{error}</p>}
            {trackingStatus === "success" && (
              <div
                className="flex items-center gap-2 rounded-xl px-3.5 py-2.5"
                style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.333 4L6 11.333 2.667 8" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-[13px] font-semibold" style={{ color: "#22c55e" }}>Application tracked successfully!</span>
              </div>
            )}
            {trackingStatus === "error" && (
              <div
                className="flex items-center gap-2 rounded-xl px-3.5 py-2.5"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <span className="text-[13px] font-semibold" style={{ color: "#ef4444" }}>Failed to save — will retry automatically.</span>
              </div>
            )}
            <div className="flex gap-2 items-stretch">
              {!isSessionComplete && (
                <button
                  type="button"
                  onClick={() => setPage(isDirectMode ? "job-description" : "cover-letter")}
                  className="w-[72px] shrink-0 py-2.5 text-[13px] font-medium text-[#a0a0a0] border border-white/[0.07] rounded-[11px] hover:bg-[#161616] transition-colors"
                >
                  ← Back
                </button>
              )}
              {isSessionComplete ? (
                <button
                  type="button"
                  onClick={handleDoneAndStartNewApplication}
                  className="flex-1 py-3 text-sm font-bold text-white bg-[#22c55e] rounded-[11px] hover:bg-[#16a34a] transition-colors"
                >
                  Done — track application ✓
                </button>
              ) : isComplete && sessionActive ? (
                <button
                  type="button"
                  disabled
                  className="flex-1 flex items-center justify-center gap-2 py-3 text-[13px] font-semibold text-[#a0a0a0] bg-[#161616] border border-white/[0.12] rounded-[11px] cursor-not-allowed"
                >
                  <PulsingDot />
                  Watching for next page…
                </button>
              ) : started ? (
                <button
                  type="button"
                  onClick={handleStopAutofill}
                  className="flex-1 py-3 text-[13px] font-semibold text-red-500 border border-red-500/30 rounded-[11px] hover:bg-red-500/5 transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartAutofill}
                  disabled={!canRunAutofill}
                  className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold text-white bg-primary-500 rounded-[11px] hover:bg-primary-600 disabled:opacity-50 transition-colors"
                >
                  <BoltIcon size={15} className="text-white" />
                  Start auto-fill
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </WorkflowLayout>
  );
}
