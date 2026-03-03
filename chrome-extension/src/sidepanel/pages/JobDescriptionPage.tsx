import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { createDraft, generateCoverLetter, ingestJob, listResumes, runPipeline } from "../services/api";
import { MSG } from "@/shared/constants";

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

  // Listen for auto-detected JD from context menu
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
          // Try to get selected text first, then try common JD containers
          const selection = window.getSelection()?.toString();
          if (selection && selection.length > 50) return selection;

          // Try common selectors for job descriptions
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
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
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

      // Direct autofill path should not carry JD/draft pipeline artifacts.
      setJobDescription("");
      setJobId(null);
      setDraft(null);
      setPipelineRun(null);
      setCoverLetter("");
      setAutofillProgress(null);
      setSelectedResumeId(resumes[0]?.id ?? null);
      setAutofillContext({
        mode: "direct",
        considerResume,
        hasStoredResume,
        suppressWorkAndSkills: !considerResume,
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Job Description</h1>
          <StepIndicator current={1} total={5} />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Paste the job description or auto-detect from the current page.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-2 flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the full job description here..."
          className="flex-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
        />
        <button
          onClick={handleAutoDetect}
          disabled={directLoading}
          className="self-start flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Auto-detect from page
        </button>

        {showDirectPrompt && (
          <div className="rounded-lg border border-primary-200 bg-primary-50/50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-800">
              Consider uploaded resume for this run?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDirectAutofillChoice(true)}
                disabled={directLoading}
                className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {directLoading ? "Loading..." : "Yes"}
              </button>
              <button
                onClick={() => handleDirectAutofillChoice(false)}
                disabled={directLoading}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {directLoading ? "Loading..." : "No"}
              </button>
              <button
                onClick={() => setShowDirectPrompt(false)}
                disabled={directLoading}
                className="ml-auto px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-white">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setShowDirectPrompt((prev) => !prev)}
            disabled={loading || directLoading}
            className="px-4 py-2.5 text-sm font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Direct Autofill
          </button>
          <button
            onClick={handleNext}
            disabled={loading || directLoading || !text.trim()}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Saving..." : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <span className="text-xs text-gray-400 font-medium">
      Step {current}/{total}
    </span>
  );
}
