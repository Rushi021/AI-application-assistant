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

  // Fetch resumes and scores on mount
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Select Resume</h1>
          <span className="text-xs text-gray-400 font-medium">Step 2/5</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Choose a resume to use or tailor for this application.
        </p>
      </div>

      {/* Tailor step: show when tailorResumeId is set */}
      {tailorResumeId ? (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          <div className="rounded-lg border-2 border-primary-200 bg-primary-50/50 p-4 space-y-3">
            <p className="text-sm font-medium text-gray-900">
              Tailor: {resumes.find((r) => r.id === tailorResumeId)?.original_filename ?? "Resume"}
            </p>
            {!showInstructionsInput ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowInstructionsInput(true)}
                  className="px-3 py-2 text-xs font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
                >
                  Add Additional Instructions
                </button>
                <button
                  onClick={handleTailorContinue}
                  disabled={tailoring}
                  className="px-3 py-2 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {tailoring ? "Tailoring..." : "Continue"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g., Emphasize cloud experience, downplay front-end work..."
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowInstructionsInput(false);
                      setInstructions("");
                    }}
                    className="px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleTailorWithInstructions}
                    disabled={tailoring}
                    className="px-3 py-2 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                  >
                    {tailoring ? "Tailoring..." : "Tailor"}
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                setTailorResumeId(null);
                setShowInstructionsInput(false);
                setInstructions("");
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
      {/* Resume slots (max 2) */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {/* Slot 1 */}
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
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center py-6 rounded-lg border-2 border-dashed transition-colors ${
              uploading ? "border-gray-200 bg-gray-50 cursor-not-allowed" : "border-gray-300 hover:border-primary-400 hover:bg-primary-50/30 cursor-pointer"
            }`}
          >
            <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-2 text-sm text-gray-500">Upload resume (.docx)</p>
          </div>
        )}

        {/* Slot 2 - only show when slot 1 is filled or we have 0 resumes */}
        {resumes.length >= 1 && (
          resumes[1] ? (
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
            <div
              onClick={() => !uploading && fileInputRef2.current?.click()}
              className={`flex flex-col items-center justify-center py-6 rounded-lg border-2 border-dashed transition-colors ${
                uploading ? "border-gray-200 bg-gray-50 cursor-not-allowed" : "border-gray-300 hover:border-primary-400 hover:bg-primary-50/30 cursor-pointer"
              }`}
            >
              <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="mt-2 text-sm text-gray-500">Upload another resume (max 2)</p>
            </div>
          )
        )}
      </div>
        </>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t bg-white space-y-2">
        {error && <p className="text-xs text-red-600">{error}</p>}
        {(removing || uploading) && (
          <p className="text-xs text-gray-500">{removing ? "Removing..." : "Uploading..."}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setPage("job-description")}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          {resumes.length < 2 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 px-4 py-2 text-sm font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 disabled:opacity-50 transition-colors"
            >
                {uploading ? "Uploading..." : "Upload Resume"}
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
      </div>
    </div>
  );
}
