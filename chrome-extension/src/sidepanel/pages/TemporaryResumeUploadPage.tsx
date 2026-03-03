import { useRef, useState } from "react";
import { useAppStore } from "../store";
import { createDraft, deleteResume, generateCoverLetter, runPipeline, uploadResume } from "../services/api";

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
    <div className="flex flex-col h-screen">
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Temporary Resume Upload</h1>
          <span className="text-xs text-gray-400 font-medium">Step 2/Temporary</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Upload a resume for this application only. It will be used to generate the cover letter and then discarded after the application is tracked.
        </p>
      </div>

      <div className="flex-1 px-4 py-3 space-y-3">
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-900">
          <p className="font-medium">Current use</p>
          <p className="mt-1">Generating a cover letter for the current application using a temporary resume.</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full px-4 py-3 text-sm font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50 disabled:opacity-50 transition-colors"
        >
          {uploading ? "Uploading and generating..." : "Upload Temporary Resume"}
        </button>
        {autofillContext.temporaryResumeFilename && (
          <p className="text-xs text-gray-500">
            Current temporary resume: {autofillContext.temporaryResumeFilename}
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.doc,.pdf"
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      <div className="px-4 py-3 border-t bg-white space-y-2">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setPage("job-description")}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={() => setPage("autofill")}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Return to Auto-Fill
          </button>
        </div>
      </div>
    </div>
  );
}
