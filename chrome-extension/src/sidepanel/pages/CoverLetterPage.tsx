import { useState } from "react";
import { useAppStore } from "../store";
import { runPipeline } from "../services/api";

export default function CoverLetterPage() {
  const { coverLetter, setCoverLetter, jobDescription, selectedResumeId, pipelineRun, setPage } = useAppStore();
  const [text, setText] = useState(coverLetter);
  const [regenerating, setRegenerating] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    if (!jobDescription) return;
    setRegenerating(true);
    setError(null);
    try {
      const run = await runPipeline({
        job_description: jobDescription,
        resume_id: selectedResumeId ?? undefined,
        resume_text: pipelineRun?.tailored_resume ?? undefined,
        cover_letter_instructions: instructions || undefined,
      });
      if (run.cover_letter) {
        setText(run.cover_letter);
        setCoverLetter(run.cover_letter);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  };

  const handleSaveAndContinue = () => {
    setCoverLetter(text);
    setPage("autofill");
  };

  const handleDownload = () => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cover_letter.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Cover Letter</h1>
          <span className="text-xs text-gray-400 font-medium">Step 4/5</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Review the generated cover letter. Edit or regenerate with instructions.
        </p>
      </div>

      {/* Cover letter text */}
      <div className="flex-1 px-4 py-2 flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none leading-relaxed"
          placeholder="Cover letter will appear here after generation..."
        />

        {/* Regenerate with instructions */}
        <div>
          <button
            onClick={() => setShowInstructions(!showInstructions)}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            {showInstructions ? "Hide instructions" : "Regenerate with instructions"}
          </button>
          {showInstructions && (
            <div className="mt-2 space-y-2">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Make it more concise, emphasize leadership..."
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              />
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {regenerating ? "Regenerating..." : "Regenerate"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-white space-y-2">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setPage("section-editor")}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 text-sm text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50"
          >
            Download
          </button>
          <button
            onClick={handleSaveAndContinue}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Continue to Auto-Fill
          </button>
        </div>
      </div>
    </div>
  );
}
