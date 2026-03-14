/**
 * Global Zustand store for the Chrome extension side panel.
 */

import { create } from "zustand";
import type {
  AutofillContext,
  AutofillProgress,
  Draft,
  DraftSection,
  PageId,
  PipelineRun,
  Resume,
  ResumeScore,
  UserProfile,
} from "@/shared/types";
import { STORAGE_KEYS } from "@/shared/constants";

interface AppState {
  // Navigation
  currentPage: PageId;
  setPage: (page: PageId) => void;

  // Auth
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuthenticated: (val: boolean) => void;
  setLoading: (val: boolean) => void;

  // User profile
  profile: UserProfile | null;
  setProfile: (p: UserProfile | null) => void;

  // Job description
  jobDescription: string;
  jobId: number | null;
  setJobDescription: (jd: string) => void;
  setJobId: (id: number | null) => void;

  // Resumes
  resumes: Resume[];
  resumeScores: ResumeScore[];
  selectedResumeId: number | null;
  setResumes: (r: Resume[]) => void;
  setResumeScores: (s: ResumeScore[]) => void;
  setSelectedResumeId: (id: number | null) => void;

  // Pipeline
  pipelineRun: PipelineRun | null;
  setPipelineRun: (run: PipelineRun | null) => void;

  // Draft
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  updateSection: (sectionId: string, updates: Partial<DraftSection>) => void;

  // Cover letter
  coverLetter: string;
  setCoverLetter: (cl: string) => void;

  // Autofill
  autofillProgress: AutofillProgress | null;
  setAutofillProgress: (p: AutofillProgress | null) => void;

  // Workflow context
  autofillContext: AutofillContext;
  setAutofillContext: (updates: Partial<AutofillContext>) => void;

  // Reset
  resetWorkflow: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Navigation
  currentPage: "login",
  setPage: (page) => set({ currentPage: page }),

  // Auth
  isAuthenticated: false,
  isLoading: true,
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setLoading: (val) => set({ isLoading: val }),

  // User profile
  profile: null,
  setProfile: (p) => set({ profile: p }),

  // Job description
  jobDescription: "",
  jobId: null,
  setJobDescription: (jd) => set({ jobDescription: jd }),
  setJobId: (id) => set({ jobId: id }),

  // Resumes
  resumes: [],
  resumeScores: [],
  selectedResumeId: null,
  setResumes: (r) => set({ resumes: r }),
  setResumeScores: (s) => set({ resumeScores: s }),
  setSelectedResumeId: (id) => set({ selectedResumeId: id }),

  // Pipeline
  pipelineRun: null,
  setPipelineRun: (run) => set({ pipelineRun: run }),

  // Draft
  draft: null,
  setDraft: (d) => set({ draft: d }),
  updateSection: (sectionId, updates) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: {
        ...draft,
        sections: draft.sections.map((s) =>
          s.section_id === sectionId ? { ...s, ...updates } : s as DraftSection
        ),
      },
    });
  },

  // Cover letter
  coverLetter: "",
  setCoverLetter: (cl) => set({ coverLetter: cl }),

  // Autofill
  autofillProgress: null,
  setAutofillProgress: (p) => set({ autofillProgress: p }),

  // Workflow context
  autofillContext: {
    mode: "standard",
    considerResume: true,
    hasStoredResume: false,
    suppressWorkAndSkills: false,
    applicationResumeSource: null,
    temporaryResumeId: null,
    temporaryResumeFilename: null,
    pendingCoverLetterGeneration: false,
    pendingCoverLetterBlockerSelector: null,
    pendingUploadSubtype: null,
    uploadedSameAsProfileResume: false,
  },
  setAutofillContext: (updates) =>
    set((state) => ({
      autofillContext: {
        ...state.autofillContext,
        ...updates,
      },
    })),

  // Reset workflow (keep auth)
  resetWorkflow: () => {
    chrome.storage.local
      .remove([STORAGE_KEYS.AUTOFILL_PROGRESS, STORAGE_KEYS.AUTOFILL_TRACE_LOG])
      .catch(() => {});
    set({
      jobDescription: "",
      jobId: null,
      resumes: [],
      resumeScores: [],
      selectedResumeId: null,
      pipelineRun: null,
      draft: null,
      coverLetter: "",
      autofillProgress: null,
      autofillContext: {
        mode: "standard",
        considerResume: true,
        hasStoredResume: false,
        suppressWorkAndSkills: false,
        applicationResumeSource: null,
        temporaryResumeId: null,
        temporaryResumeFilename: null,
        pendingCoverLetterGeneration: false,
        pendingCoverLetterBlockerSelector: null,
        pendingUploadSubtype: null,
        uploadedSameAsProfileResume: false,
      },
      currentPage: "job-description",
    });
  },
}));

/**
 * Initialise auth state from chrome.storage on extension load.
 */
export async function initAuthState() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.SESSION_ID]);
  const hasToken = !!result[STORAGE_KEYS.ACCESS_TOKEN];

  // Ensure session_id exists
  if (!result[STORAGE_KEYS.SESSION_ID]) {
    const sessionId = crypto.randomUUID();
    await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_ID]: sessionId });
  }

  useAppStore.getState().setAuthenticated(hasToken);
  useAppStore.getState().setLoading(false);

  if (hasToken) {
    useAppStore.getState().setPage("job-description");
  }
}
