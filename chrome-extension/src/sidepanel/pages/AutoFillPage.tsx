import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../store";
import { MSG } from "@/shared/constants";
import type { AutofillProgress } from "@/shared/types";

export default function AutoFillPage() {
  const { autofillProgress, setAutofillProgress, draft, coverLetter, setPage } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  // Listen for autofill progress updates from content script
  useEffect(() => {
    const listener = (message: { type: string; data: AutofillProgress }) => {
      if (message.type === MSG.AUTOFILL_PROGRESS) {
        setAutofillProgress(message.data);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [setAutofillProgress]);

  const handleStartAutofill = useCallback(async () => {
    setStarted(true);
    setError(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError("No active tab found. Navigate to a job application page first.");
        return;
      }

      // Inject content script if not already injected
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/content.js"],
        });
      } catch {
        // Script may already be injected
      }

      // Send start message to content script
      chrome.tabs.sendMessage(tab.id, { type: MSG.START_AUTOFILL }, (response) => {
        if (chrome.runtime.lastError) {
          setError("Could not connect to the page. Try refreshing the page.");
          setStarted(false);
        } else if (response?.error) {
          setError(response.error);
          setStarted(false);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start auto-fill");
      setStarted(false);
    }
  }, []);

  const progress = autofillProgress;
  const isComplete = progress?.completed ?? false;
  const isPaused = progress?.paused ?? false;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Auto-Fill Application</h1>
          <span className="text-xs text-gray-400 font-medium">Step 5/5</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Auto-fill the job application form using your profile data.
        </p>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 space-y-2">
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-gray-700">Resume: {draft ? "Ready" : "Not set"}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-gray-700">Cover Letter: {coverLetter ? "Ready" : "Not set"}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="flex-1 px-4 py-2">
        {!started && !progress && (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-primary-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">Ready to auto-fill</p>
            <p className="text-xs text-gray-500 mt-1">
              Make sure you're on the job application page,<br />then click the button below.
            </p>
          </div>
        )}

        {progress && (
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Progress</span>
                <span>{progress.filled + progress.manual + progress.skipped}/{progress.total}</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isComplete ? "bg-green-500" : isPaused ? "bg-yellow-500" : "bg-primary-500"
                  }`}
                  style={{
                    width: `${progress.total > 0 ? ((progress.filled + progress.manual + progress.skipped) / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Status */}
            {isPaused && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-xs font-medium text-yellow-800">Paused - Check the application page</span>
                </div>
                <p className="text-xs text-yellow-700 mt-1">
                  A field needs your attention. Fill it manually and check the box to continue.
                </p>
              </div>
            )}

            {isComplete && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-xs font-medium text-green-800">Auto-fill complete!</span>
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Filled" value={progress.filled} color="text-green-600" bg="bg-green-50" />
              <StatCard label="Manual" value={progress.manual} color="text-yellow-600" bg="bg-yellow-50" />
              <StatCard label="Skipped" value={progress.skipped} color="text-gray-600" bg="bg-gray-50" />
            </div>

            {/* Current field */}
            {progress.currentField && !isPaused && (
              <p className="text-xs text-gray-500">
                Filling: <span className="font-medium">{progress.currentField}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-white space-y-2">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setPage("cover-letter")}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          {!isComplete ? (
            <button
              onClick={handleStartAutofill}
              disabled={started && !isComplete}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {started ? (isPaused ? "Waiting for manual fill..." : "Filling...") : "Start Auto-Fill"}
            </button>
          ) : (
            <button
              onClick={async () => {
                // Trigger application tracking
                const store = useAppStore.getState();
                await chrome.runtime.sendMessage({
                  type: "TRACK_APPLICATION",
                  data: {
                    job_id: store.jobId,
                    resume_id: store.selectedResumeId,
                  },
                });
                store.resetWorkflow();
              }}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Done - Start New Application
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-lg p-2 text-center`}>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}
