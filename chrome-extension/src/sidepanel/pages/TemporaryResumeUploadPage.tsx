import { useRef, useState, useEffect } from "react";
import { useAppStore } from "../store";
import type { Draft, PipelineRun } from "@/shared/types";
import {
  createDraft,
  deleteResume,
  generateCoverLetter,
  ingestJob,
  listResumes,
  runPipeline,
  uploadResume,
} from "../services/api";
import WorkflowLayout from "../components/WorkflowLayout";
import { forgetResumeFile, rememberResumeFile } from "../resumeLocalCache";
import { MAX_RESUMES_PER_SESSION } from "@/shared/constants";

async function runCoverLetterFromResume(
  jobDescriptionText: string,
  resumeId: number,
  setters: {
    setJobDescription: (s: string) => void;
    setJobId: (id: number | null) => void;
    setPipelineRun: (r: PipelineRun | null) => void;
    setDraft: (d: Draft | null) => void;
    setCoverLetter: (s: string) => void;
    setSelectedResumeId: (id: number | null) => void;
  }
) {
  const job = await ingestJob(jobDescriptionText.trim());
  setters.setJobDescription(jobDescriptionText.trim());
  setters.setJobId(job.id);
  setters.setSelectedResumeId(resumeId);

  const run = await runPipeline({
    job_description: jobDescriptionText.trim(),
    resume_id: resumeId,
  });
  setters.setPipelineRun(run);
  const draft = await createDraft({
    resume_id: resumeId,
    run_id: run.id,
    starting_source: "tailored",
    job_description: jobDescriptionText.trim(),
  });
  setters.setDraft(draft);
  const coverLetterResult = await generateCoverLetter(draft.id);
  setters.setCoverLetter(coverLetterResult.cover_letter);
}

export default function TemporaryResumeUploadPage() {
  const {
    jobDescription,
    setJobDescription,
    setJobId,
    setPipelineRun,
    setDraft,
    setCoverLetter,
    setAutofillContext,
    autofillContext,
    setPage,
    resumes,
    setResumes,
    setSelectedResumeId,
    selectedResumeId,
  } = useAppStore();
  const [uploading, setUploading] = useState(false);
  const [generatingFromExisting, setGeneratingFromExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jdText, setJdText] = useState(jobDescription);
  const [selectedResumeIdLocal, setSelectedResumeIdLocal] = useState<number | null>(selectedResumeId ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setJdText(jobDescription);
  }, [jobDescription]);

  useEffect(() => {
    listResumes()
      .then((list) => {
        setResumes(list);
        setSelectedResumeIdLocal((prev) => {
          if (prev != null && list.some((r) => r.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {
        setError("Could not load uploaded resumes.");
      });
  }, [setResumes]);

  const effectiveJd = jdText.trim();

  const runPipelineSuccess = () => {
    setAutofillContext({
      pendingCoverLetterGeneration: false,
      pendingCoverLetterBlockerSelector: null,
      pendingUploadSubtype: null,
    });
    setPage("cover-letter");
  };

  const handleGenerateFromSelectedResume = async () => {
    if (!effectiveJd) {
      setError("Paste a job description (or role summary) above so we can tailor the cover letter.");
      return;
    }
    if (selectedResumeIdLocal == null) {
      setError("Select a resume from the list.");
      return;
    }

    setGeneratingFromExisting(true);
    setError(null);
    try {
      await runCoverLetterFromResume(effectiveJd, selectedResumeIdLocal, {
        setJobDescription,
        setJobId,
        setPipelineRun,
        setDraft,
        setCoverLetter,
        setSelectedResumeId,
      });
      setAutofillContext({
        applicationResumeSource: "profile_resume",
        temporaryResumeId: null,
        temporaryResumeFilename: null,
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
      });
      runPipelineSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate cover letter");
    } finally {
      setGeneratingFromExisting(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!effectiveJd) {
      setError("Paste a job description (or role summary) before uploading a resume.");
      return;
    }
    if (resumes.length >= MAX_RESUMES_PER_SESSION) {
      setError(
        `Maximum ${MAX_RESUMES_PER_SESSION} resumes per session. Select one of your uploaded resumes above, or remove a resume from the Resume step and try again.`
      );
      return;
    }

    setUploading(true);
    setError(null);
    try {
      if (autofillContext.temporaryResumeId) {
        try {
          forgetResumeFile(autofillContext.temporaryResumeId);
          await deleteResume(autofillContext.temporaryResumeId);
        } catch {
          // best-effort cleanup before replacing temp resume
        }
      }

      const resume = await uploadResume(file, true);
      rememberResumeFile(resume.id, file);
      setResumes([resume, ...resumes.filter((r) => r.id !== resume.id)]);
      setSelectedResumeIdLocal(resume.id);

      await runCoverLetterFromResume(effectiveJd, resume.id, {
        setJobDescription,
        setJobId,
        setPipelineRun,
        setDraft,
        setCoverLetter,
        setSelectedResumeId,
      });

      setAutofillContext({
        applicationResumeSource: "temporary_resume",
        temporaryResumeId: resume.id,
        temporaryResumeFilename: resume.original_filename,
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
      });
      runPipelineSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Temporary resume upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const busy = uploading || generatingFromExisting;

  return (
    <WorkflowLayout
      title="Temporary resume"
      subtitle="Choose a resume and job context to generate a cover letter for this application"
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

        <div className="space-y-1">
          <label className="text-xs font-medium text-wf-text">Job description or role summary</label>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the job description, posting text, or a short role summary (required for cover letter generation)."
            rows={5}
            className="w-full rounded-[10px] border border-wf-border bg-wf-surface px-3 py-2 text-xs text-wf-text placeholder:text-wf-muted focus:border-primary-500 focus:outline-none"
          />
          <p className="text-[10px] text-wf-muted">
            Needed even when you didn&apos;t use the Job description step first. It is saved with your application when you track it.
          </p>
        </div>

        <div className="rounded-xl border border-wf-borderBright bg-wf-surface p-3 text-xs text-wf-muted leading-relaxed">
          <p className="font-semibold text-wf-text mb-2">Use an uploaded resume</p>
          <p className="mb-2">
            You can have up to {MAX_RESUMES_PER_SESSION} resumes in this session. Pick one to generate the cover letter without uploading again.
          </p>
          {resumes.length === 0 ? (
            <p className="text-wf-muted">No resumes loaded yet. Upload one below (if under the limit).</p>
          ) : (
            <>
              <select
                value={selectedResumeIdLocal ?? ""}
                onChange={(e) => setSelectedResumeIdLocal(Number(e.target.value) || null)}
                disabled={busy}
                className="w-full rounded-[10px] border border-wf-border bg-wf-bg px-3 py-2 text-xs text-wf-text"
              >
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.original_filename}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleGenerateFromSelectedResume}
                disabled={busy || selectedResumeIdLocal == null}
                className="mt-2 w-full px-4 py-2.5 text-sm font-semibold text-white bg-primary-500 rounded-[10px] hover:bg-primary-600 disabled:opacity-50"
              >
                {generatingFromExisting ? "Generating…" : "Generate cover letter with selected resume"}
              </button>
            </>
          )}
        </div>

        <div className="rounded-xl border border-wf-borderBright bg-wf-surface p-3 text-xs text-wf-muted leading-relaxed">
          <p className="font-semibold text-wf-text mb-1">Or upload a temporary resume</p>
          <p className="mb-2">
            Uploads here are stored in your account and can be linked when you track the application. If you already have 2
            resumes, free a slot on the Resume step or use the dropdown above.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
                disabled={busy || resumes.length >= MAX_RESUMES_PER_SESSION}
            className="w-full px-4 py-3 text-sm font-semibold text-primary-400 border border-wf-border rounded-[10px] hover:bg-wf-surfaceHover disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading and generating…" : "Upload temporary resume"}
          </button>
          {autofillContext.temporaryResumeFilename && (
            <p className="mt-2 text-xs text-wf-muted">Current temp file: {autofillContext.temporaryResumeFilename}</p>
          )}
        </div>

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
