import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { ingestJob } from "../services/api";
import { MSG } from "@/shared/constants";

export default function JobDescriptionPage() {
  const { jobDescription, setJobDescription, setJobId, setPage } = useAppStore();
  const [text, setText] = useState(jobDescription);
  const [loading, setLoading] = useState(false);
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
      setPage("resume-select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job description");
    } finally {
      setLoading(false);
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
          className="self-start flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Auto-detect from page
        </button>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-white">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <button
          onClick={handleNext}
          disabled={loading || !text.trim()}
          className="w-full px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Saving..." : "Next"}
        </button>
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
