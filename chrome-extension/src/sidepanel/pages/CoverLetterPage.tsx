import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { generateCoverLetter } from "../services/api";
import WorkflowLayout from "../components/WorkflowLayout";

export default function CoverLetterPage() {
  const { draft, coverLetter, setCoverLetter, setPage } = useAppStore();
  const [text, setText] = useState(coverLetter);
  const [regenerating, setRegenerating] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(coverLetter);
  }, [coverLetter]);

  const handleRegenerate = async () => {
    if (!draft) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await generateCoverLetter(draft.id, {
        cover_letter_instructions: instructions || undefined,
      });
      setText(res.cover_letter);
      setCoverLetter(res.cover_letter);
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
    <WorkflowLayout
      title="Cover letter"
      subtitle="Review, edit, or regenerate before auto-fill"
      footer={
        <>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage("section-editor")}
              className="px-4 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover shrink-0"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="px-4 py-2.5 text-sm font-medium text-primary-400 border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover shrink-0"
            >
              Download
            </button>
            <button
              type="button"
              onClick={handleSaveAndContinue}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600"
            >
              Continue to auto-fill →
            </button>
          </div>
        </>
      }
    >
      <div className="flex-1 flex flex-col gap-3 px-4 pb-2 min-h-0">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 w-full min-h-[220px] rounded-[10px] border border-wf-border bg-wf-surface px-3.5 py-3 text-sm text-wf-text placeholder:text-wf-dim resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/40 outline-none leading-relaxed"
          placeholder="Cover letter will appear here after generation…"
        />

        <div>
          <button
            type="button"
            onClick={() => setShowInstructions(!showInstructions)}
            className="text-xs text-primary-400 hover:text-primary-300 font-medium"
          >
            {showInstructions ? "Hide instructions" : "Regenerate with instructions"}
          </button>
          {showInstructions && (
            <div className="mt-2 space-y-2">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Shorter, emphasize leadership…"
                rows={2}
                className="w-full rounded-[10px] border border-wf-border bg-wf-bg px-3 py-2 text-xs text-wf-text placeholder:text-wf-dim resize-none focus:border-primary-500 outline-none"
              />
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          )}
        </div>
      </div>
    </WorkflowLayout>
  );
}
