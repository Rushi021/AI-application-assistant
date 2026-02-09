import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import {
  listResumes,
  scoreResumes,
  uploadResume,
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
    setPage,
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch resumes and scores on mount
  useEffect(() => {
    (async () => {
      try {
        const resumeList = await listResumes();
        setResumes(resumeList);

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
      setSelectedResumeId(newResume.id);

      // Re-score
      if (jobDescription) {
        const scores = await scoreResumes(jobDescription);
        setResumeScores(scores);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  const handleTailor = async (resumeId: number) => {
    setError(null);
    setTailoring(true);
    try {
      // Run pipeline
      const run = await runPipeline({
        job_description: jobDescription,
        resume_id: resumeId,
      });
      setPipelineRun(run);

      if (run.cover_letter) {
        setCoverLetter(run.cover_letter);
      }

      // Create draft from tailored output
      const draft = await createDraft({
        resume_id: resumeId,
        run_id: run.id,
        starting_source: "tailored",
        job_description: jobDescription,
      });
      setDraft(draft);
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

      {/* Resume list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {resumes.length === 0 ? (
          <div className="text-center py-8">
            <svg className="w-12 h-12 mx-auto text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-2 text-sm text-gray-500">No resumes uploaded yet.</p>
            <p className="text-xs text-gray-400">Upload a .docx file to get started.</p>
          </div>
        ) : (
          resumes.map((r) => (
            <ResumeCard
              key={r.id}
              resume={r}
              score={resumeScores.find((s) => s.resume_id === r.id)}
              selected={selectedResumeId === r.id}
              onSelect={() => setSelectedResumeId(r.id)}
              onUse={() => handleUse(r.id)}
              onTailor={() => handleTailor(r.id)}
              tailoring={tailoring}
            />
          ))
        )}
      </div>

      {/* Footer */}
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-1 px-4 py-2 text-sm font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading..." : "Upload Resume"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.doc,.pdf"
          onChange={handleUpload}
          className="hidden"
        />
      </div>
    </div>
  );
}
