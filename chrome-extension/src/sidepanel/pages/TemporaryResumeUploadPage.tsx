import { useRef, useState } from "react";
import { useAppStore } from "../store";
import { createDraft, deleteResume, generateCoverLetter, runPipeline, uploadResume } from "../services/api";
import WorkflowLayout from "../components/WorkflowLayout";

export default function TemporaryResumeUploadPage() {
  const {
    jobDescription,
    setPipelineRun,
    setDraft,
    setCoverLetter,
    setAutofillContext,
    autofillContext,
    setPage,
  } = useAppStore();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!jobDescription.trim()) {
      setError("Job description is required before temporary resume upload.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      if (autofillContext.temporaryResumeId) {
        try {
          await deleteResume(autofillContext.temporaryResumeId);
        } catch {
          // best-effort cleanup before replacing temp resume
        }
      }

      const resume = await uploadResume(file);
      setAutofillContext({
        applicationResumeSource: "temporary_resume",
        temporaryResumeId: resume.id,
        temporaryResumeFilename: resume.original_filename,
        pendingUploadSubtype: "cover_letter",
      });

      const run = await runPipeline({
        job_description: jobDescription,
        resume_id: resume.id,
      });
      setPipelineRun(run);
      const draft = await createDraft({
        resume_id: resume.id,
        run_id: run.id,
        starting_source: "tailored",
        job_description: jobDescription,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Temporary resume upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <WorkflowLayout
      title="Temporary resume"
      subtitle="One-time upload to generate a cover letter for this application"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setAutofillContext({
                pendingCoverLetterGeneration: false,
                pendingCoverLetterBlockerSelector: null,
                pendingUploadSubtype: null,
              });
              setPage("job-description");
            }}
            className="px-4 py-2.5 text-sm font-medium text-wf-text border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => setPage("autofill")}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600"
          >
            Return to auto-fill
          </button>
        </div>
      }
    >
      <div className="flex-1 px-4 py-3 space-y-3">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="rounded-xl border border-wf-borderBright bg-wf-surface p-3 text-xs text-wf-muted leading-relaxed">
          <p className="font-semibold text-wf-text mb-1">How this works</p>
          <p>
            This file is used to generate your cover letter for the current blocker. It can be removed after the
            application is tracked.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full px-4 py-3 text-sm font-semibold text-primary-400 border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover disabled:opacity-50 transition-colors"
        >
          {uploading ? "Uploading and generating…" : "Upload temporary resume"}
        </button>
        {autofillContext.temporaryResumeFilename && (
          <p className="text-xs text-wf-muted">Current file: {autofillContext.temporaryResumeFilename}</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.doc,.pdf"
          onChange={handleUpload}
          className="hidden"
        />
      </div>
    </WorkflowLayout>
  );
}
