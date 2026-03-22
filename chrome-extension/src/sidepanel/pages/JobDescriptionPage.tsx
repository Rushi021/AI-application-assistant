import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { createDraft, generateCoverLetter, ingestJob, listResumes, runPipeline } from "../services/api";
import { MSG, STORAGE_KEYS } from "@/shared/constants";
import WorkflowLayout from "../components/WorkflowLayout";

export default function JobDescriptionPage() {
  const {
    jobDescription,
    setJobDescription,
    setJobId,
    setDraft,
    setPipelineRun,
    setCoverLetter,
    setAutofillProgress,
    setAutofillContext,
    setSelectedResumeId,
    autofillContext,
    setPage,
  } = useAppStore();
  const [text, setText] = useState(jobDescription);
  const [loading, setLoading] = useState(false);
  const [directLoading, setDirectLoading] = useState(false);
  const [showDirectPrompt, setShowDirectPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearAutofillArtifacts = async () => {
    setAutofillProgress(null);
    await chrome.storage.local
      .remove([STORAGE_KEYS.AUTOFILL_PROGRESS, STORAGE_KEYS.AUTOFILL_TRACE_LOG])
      .catch(() => {});
  };

  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.detected_jd?.newValue) {
        setText(changes.detected_jd.newValue);
        chrome.storage.local.remove("detected_jd");
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleAutoDetect = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const selection = window.getSelection()?.toString();
          if (selection && selection.length > 50) return selection;

          const selectors = [
            '[data-testid="jobDescription"]',
            ".job-description",
            ".job-details",
            "#job-description",
            "#jobDescriptionText",
            'article[role="main"]',
            ".description__text",
            ".jobs-description",
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el?.textContent && el.textContent.length > 100) {
              return el.textContent.trim();
            }
          }
          return null;
        },
      });

      const detected = results?.[0]?.result;
      if (detected) {
        setText(detected);
        setError(null);
      } else {
        setError("Could not detect job description. Try selecting the text and right-clicking.");
      }
    } catch {
      setError("Failed to access the page. Make sure you're on a job listing page.");
    }
  };

  const handleNext = async () => {
    if (!text.trim()) {
      setError("Please paste a job description.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const job = await ingestJob(text.trim());
      await clearAutofillArtifacts();
      setJobDescription(text.trim());
      setJobId(job.id);
      if (autofillContext.pendingCoverLetterGeneration) {
        if (autofillContext.applicationResumeSource === "profile_resume") {
          const resumes = await listResumes();
          const resumeId = useAppStore.getState().selectedResumeId ?? resumes[0]?.id ?? null;
          if (!resumeId) {
            setAutofillContext({
              pendingUploadSubtype: "cover_letter",
            });
            setPage("temporary-resume-upload");
            return;
          }
          setSelectedResumeId(resumeId);
          const run = await runPipeline({
            job_description: text.trim(),
            resume_id: resumeId,
          });
          setPipelineRun(run);
          const draft = await createDraft({
            resume_id: resumeId,
            run_id: run.id,
            starting_source: "tailored",
            job_description: text.trim(),
          });
          setDraft(draft);
          const coverLetterResult = await generateCoverLetter(draft.id);
          setCoverLetter(coverLetterResult.cover_letter);
          setAutofillContext({
            pendingCoverLetterGeneration: false,
            pendingCoverLetterBlockerSelector: null,
            pendingUploadSubtype: null,
          });
          setPage("cover-letter");
          return;
        }

        setAutofillContext({
          pendingUploadSubtype: "cover_letter",
        });
        setPage("temporary-resume-upload");
        return;
      }
      setAutofillContext({
        mode: "standard",
        considerResume: true,
        suppressWorkAndSkills: false,
        applicationResumeSource: null,
        temporaryResumeId: null,
        temporaryResumeFilename: null,
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
        uploadedSameAsProfileResume: false,
      });
      setPage("resume-select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job description");
    } finally {
      setLoading(false);
    }
  };

  const handleDirectAutofillChoice = async (considerResume: boolean) => {
    setDirectLoading(true);
    setError(null);
    try {
      const resumes = await listResumes();
      const hasStoredResume = resumes.length > 0;

      setJobDescription("");
      setJobId(null);
      setDraft(null);
      setPipelineRun(null);
      setCoverLetter("");
      await clearAutofillArtifacts();
      setSelectedResumeId(resumes[0]?.id ?? null);
      setAutofillContext({
        mode: "direct",
        considerResume,
        hasStoredResume,
        suppressWorkAndSkills: !considerResume,
        applicationResumeSource: null,
        temporaryResumeId: null,
        temporaryResumeFilename: null,
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
        uploadedSameAsProfileResume: false,
      });
      setPage("autofill");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start direct autofill");
    } finally {
      setDirectLoading(false);
      setShowDirectPrompt(false);
    }
  };

  return (
    <WorkflowLayout
      title="Job description"
      subtitle="Paste or auto-detect from the current tab"
      footer={
        <>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDirectPrompt((prev) => !prev)}
              disabled={loading || directLoading}
              className="px-4 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover disabled:opacity-50 transition-colors"
            >
              Direct autofill
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={loading || directLoading || !text.trim()}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Saving..." : "Continue →"}
            </button>
          </div>
        </>
      }
    >
      <div className="flex-1 flex flex-col gap-3 px-4 pb-2 min-h-0">
        <button
          type="button"
          onClick={handleAutoDetect}
          disabled={directLoading}
          className="flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover disabled:opacity-50 transition-colors"
        >
          <span className="text-base" aria-hidden>
            ⚡
          </span>
          Auto-detect from page
        </button>

        <div className="relative flex-1 flex flex-col min-h-[200px]">
          <div className="text-[11px] font-semibold text-wf-muted tracking-wide uppercase mb-1.5">Or paste manually</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the full job description here..."
            className="flex-1 w-full min-h-[200px] rounded-[10px] border border-wf-border bg-wf-surface px-3.5 py-3 text-sm text-wf-text placeholder:text-wf-dim resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/40 outline-none leading-relaxed box-border"
          />
          {text.length > 0 && (
            <div className="absolute bottom-2.5 right-2.5 text-[11px] text-wf-dim pointer-events-none">
              {text.length} chars
            </div>
          )}
        </div>

        {showDirectPrompt && (
          <div className="rounded-xl border border-wf-borderBright bg-wf-surface p-3 space-y-2">
            <p className="text-xs font-medium text-wf-text">Skip tailoring and fill the open form now?</p>
            <p className="text-[11px] text-wf-muted leading-snug">
              You can still use your profile data. Optionally include your stored resume for uploads and richer answers.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDirectAutofillChoice(true)}
                disabled={directLoading}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                {directLoading ? "…" : "Use profile + resume"}
              </button>
              <button
                type="button"
                onClick={() => handleDirectAutofillChoice(false)}
                disabled={directLoading}
                className="px-3 py-1.5 text-xs font-medium text-wf-text border border-wf-border rounded-lg hover:bg-wf-surfaceHover disabled:opacity-50"
              >
                {directLoading ? "…" : "Profile only"}
              </button>
              <button
                type="button"
                onClick={() => setShowDirectPrompt(false)}
                disabled={directLoading}
                className="ml-auto px-2 py-1.5 text-[11px] text-wf-muted hover:text-wf-text"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </WorkflowLayout>
  );
}
