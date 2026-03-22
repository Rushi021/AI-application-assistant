import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import {
  listResumes,
  scoreResumes,
  uploadResume,
  deleteResume,
  runPipeline,
  createDraft,
} from "../services/api";
import ResumeCard from "../components/ResumeCard";
import WorkflowLayout from "../components/WorkflowLayout";

export default function ResumeSelectPage() {
  const {
    jobDescription,
    resumes,
    setResumes,
    resumeScores,
    setResumeScores,
    selectedResumeId,
    setSelectedResumeId,
    setPipelineRun,
    setDraft,
    setCoverLetter,
    setAutofillContext,
    setPage,
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [tailorResumeId, setTailorResumeId] = useState<number | null>(null);
  const [showInstructionsInput, setShowInstructionsInput] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const resumeList = await listResumes();
        setResumes(resumeList);
        setAutofillContext({ hasStoredResume: resumeList.length > 0 });

        if (resumeList.length > 0 && jobDescription) {
          const scores = await scoreResumes(jobDescription);
          setResumeScores(scores);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load resumes");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const newResume = await uploadResume(file);
      const updated = [newResume, ...resumes];
      setResumes(updated);
      setAutofillContext({ hasStoredResume: updated.length > 0 });
      setSelectedResumeId(newResume.id);

      if (jobDescription) {
        const scores = await scoreResumes(jobDescription);
        setResumeScores(scores);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      fileInputRef.current!.value = "";
      fileInputRef2.current!.value = "";
    }
  };

  const handleRemove = async (resumeId: number) => {
    setRemoving(true);
    setError(null);
    try {
      await deleteResume(resumeId);
      const updated = resumes.filter((r) => r.id !== resumeId);
      setResumes(updated);
      setAutofillContext({ hasStoredResume: updated.length > 0 });
      if (selectedResumeId === resumeId) {
        setSelectedResumeId(updated[0]?.id ?? null);
      }
      if (jobDescription && updated.length > 0) {
        const scores = await scoreResumes(jobDescription);
        setResumeScores(scores);
      } else {
        setResumeScores([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove resume");
    } finally {
      setRemoving(false);
    }
  };

  const handleUse = async (resumeId: number) => {
    setError(null);
    setTailoring(true);
    try {
      const draft = await createDraft({
        resume_id: resumeId,
        starting_source: "base",
        job_description: jobDescription,
      });
      setDraft(draft);
      setPage("section-editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create draft");
    } finally {
      setTailoring(false);
    }
  };

  const handleTailorClick = (resumeId: number) => {
    setError(null);
    setTailorResumeId(resumeId);
    setShowInstructionsInput(false);
    setInstructions("");
  };

  const handleTailorContinue = async () => {
    if (!tailorResumeId) return;
    setError(null);
    setTailoring(true);
    try {
      const run = await runPipeline({
        job_description: jobDescription,
        resume_id: tailorResumeId,
      });
      setPipelineRun(run);
      const draft = await createDraft({
        resume_id: tailorResumeId,
        run_id: run.id,
        starting_source: "tailored",
        job_description: jobDescription,
      });
      setDraft(draft);
      setTailorResumeId(null);
      setShowInstructionsInput(false);
      setInstructions("");
      setPage("section-editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tailoring failed");
    } finally {
      setTailoring(false);
    }
  };

  const handleTailorWithInstructions = async () => {
    if (!tailorResumeId) return;
    setError(null);
    setTailoring(true);
    try {
      const run = await runPipeline({
        job_description: jobDescription,
        resume_id: tailorResumeId,
        tailor_instructions: instructions.trim() || undefined,
      });
      setPipelineRun(run);
      const draft = await createDraft({
        resume_id: tailorResumeId,
        run_id: run.id,
        starting_source: "tailored",
        job_description: jobDescription,
      });
      setDraft(draft);
      setTailorResumeId(null);
      setShowInstructionsInput(false);
      setInstructions("");
      setPage("section-editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tailoring failed");
    } finally {
      setTailoring(false);
    }
  };

  const tailorName = resumes.find((r) => r.id === tailorResumeId)?.original_filename ?? "Resume";

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-wf-bg text-wf-text">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-wf-border border-t-primary-500" />
        </div>
      </div>
    );
  }

  return (
    <WorkflowLayout
      title={tailorResumeId ? "Tailor resume" : "Select resume"}
      subtitle={
        tailorResumeId
          ? tailorName
          : "Pick a resume to use or tailor for this role"
      }
      footer={
        tailorResumeId ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTailorResumeId(null);
                setShowInstructionsInput(false);
                setInstructions("");
              }}
              className="px-4 py-2 text-sm text-wf-muted border border-transparent rounded-[10px] hover:text-wf-text"
            >
              ← Cancel
            </button>
          </div>
        ) : (
          <>
            {error && <p className="text-xs text-red-400">{error}</p>}
            {(removing || uploading) && (
              <p className="text-xs text-wf-muted">{removing ? "Removing…" : "Uploading…"}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage("job-description")}
                className="px-4 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover"
              >
                ← Back
              </button>
              {resumes.length < 2 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex-1 py-2.5 text-sm font-medium text-primary-500 border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "+ Upload resume"}
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.doc,.pdf"
              onChange={handleUpload}
              className="hidden"
            />
            <input
              ref={fileInputRef2}
              type="file"
              accept=".docx,.doc,.pdf"
              onChange={handleUpload}
              className="hidden"
            />
          </>
        )
      }
    >
      {tailorResumeId ? (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          <div className="rounded-xl border border-wf-border bg-wf-surface p-4 space-y-3">
            <p className="text-sm font-semibold text-wf-text">What should the AI focus on?</p>
            <p className="text-[11px] text-wf-muted leading-snug">
              Optional: add instructions below, or continue to run the default tailoring pipeline.
            </p>
            {!showInstructionsInput ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowInstructionsInput(true)}
                  className="px-3 py-2 text-xs font-medium text-wf-text border border-wf-border rounded-lg hover:bg-wf-surfaceHover"
                >
                  Add specific instructions
                </button>
                <button
                  type="button"
                  onClick={handleTailorContinue}
                  disabled={tailoring}
                  className="px-3 py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50"
                >
                  {tailoring ? "Starting…" : "Start tailoring →"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Emphasize cloud experience, keep ProHealth on page one…"
                  className="w-full px-3 py-2 text-xs border border-wf-border rounded-[10px] bg-wf-bg text-wf-text placeholder:text-wf-dim resize-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 outline-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowInstructionsInput(false);
                      setInstructions("");
                    }}
                    className="px-3 py-2 text-xs font-medium text-wf-text border border-wf-border rounded-lg hover:bg-wf-surfaceHover"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleTailorWithInstructions}
                    disabled={tailoring}
                    className="px-3 py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    {tailoring ? "Starting…" : "Start tailoring →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          {resumes[0] ? (
            <ResumeCard
              key={resumes[0].id}
              resume={resumes[0]}
              score={resumeScores.find((s) => s.resume_id === resumes[0].id)}
              selected={selectedResumeId === resumes[0].id}
              onSelect={() => setSelectedResumeId(resumes[0].id)}
              onUse={() => handleUse(resumes[0].id)}
              onTailor={() => handleTailorClick(resumes[0].id)}
              onRemove={() => handleRemove(resumes[0].id)}
              tailoring={tailoring}
            />
          ) : (
            <button
              type="button"
              onClick={() => !uploading && fileInputRef.current?.click()}
              disabled={uploading}
              className={`w-full flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed transition-colors ${
                uploading
                  ? "border-wf-border bg-wf-surface/50 cursor-not-allowed opacity-60"
                  : "border-wf-borderBright hover:border-primary-500/60 bg-wf-surface/40 hover:bg-wf-surface cursor-pointer"
              }`}
            >
              <span className="text-3xl mb-1" aria-hidden>
                📄
              </span>
              <p className="text-sm text-wf-muted">Upload resume (.docx, .pdf)</p>
            </button>
          )}

          {resumes.length >= 1 &&
            (resumes[1] ? (
              <ResumeCard
                key={resumes[1].id}
                resume={resumes[1]}
                score={resumeScores.find((s) => s.resume_id === resumes[1].id)}
                selected={selectedResumeId === resumes[1].id}
                onSelect={() => setSelectedResumeId(resumes[1].id)}
                onUse={() => handleUse(resumes[1].id)}
                onTailor={() => handleTailorClick(resumes[1].id)}
                onRemove={() => handleRemove(resumes[1].id)}
                tailoring={tailoring}
              />
            ) : (
              <button
                type="button"
                onClick={() => !uploading && fileInputRef2.current?.click()}
                disabled={uploading}
                className={`w-full flex flex-col items-center justify-center py-6 rounded-xl border-2 border-dashed transition-colors ${
                  uploading
                    ? "border-wf-border bg-wf-surface/50 cursor-not-allowed opacity-60"
                    : "border-wf-borderBright hover:border-primary-500/60 bg-wf-surface/40 hover:bg-wf-surface cursor-pointer"
                }`}
              >
                <span className="text-2xl mb-1" aria-hidden>
                  +
                </span>
                <p className="text-sm text-wf-muted">Upload another resume (max 2)</p>
              </button>
            ))}
        </div>
      )}
    </WorkflowLayout>
  );
}
