// ---------------------------------------------------------------------------
// User / Auth
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: number;
  username: string;
  email: string | null;
  picture_url: string | null;

  full_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;

  linkedin_url: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  years_of_experience: number | null;
  current_title: string | null;
  current_company: string | null;

  degree: string | null;
  field_of_study: string | null;
  university: string | null;
  graduation_year: number | null;
  gpa: number | null;

  visa_status: string | null;
  work_authorization: string | null;
  sponsorship_needed: boolean | null;

  gender: string | null;
  ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;

  expected_salary: string | null;
  current_salary: string | null;
  salary_currency: string | null;

  custom_fields: Record<string, unknown> | null;
}

export interface EducationHistoryEntry {
  university: string;
  degree: string;
  field_of_study: string;
  graduation_year: number | null;
  gpa: number | null;
}

export interface WorkExperienceEntry {
  job_title: string;
  company: string;
  location: string;
  start_month: string;
  start_year: string;
  end_month: string;
  end_year: string;
  description: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  is_new_user: boolean;
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export interface Resume {
  id: number;
  session_id: string;
  original_filename: string;
  file_key?: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  /** When true, the .docx is not stored on the API server; keep a local copy via resumeLocalCache. */
  client_stored?: boolean;
}

export interface ResumeScore {
  resume_id: number;
  original_filename: string;
  score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  rationale: string;
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export interface Job {
  id: number;
  session_id: string;
  raw_text: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface PipelineRun {
  id: number;
  session_id: string;
  status: "queued" | "running" | "completed" | "failed";
  job_description: string | null;
  resume_text: string | null;
  tailored_resume: string | null;
  tailored_sections: string | null;
  cover_letter: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export interface DraftSection {
  id: number;
  draft_id: number;
  section_id: string;
  section_title: string;
  order_index: number;
  original_text: string;
  current_text: string;
  proposed_text: string | null;
  last_feedback: "liked" | "disliked" | null;
  editable: boolean;
  section_group?: string | null;
}

export interface Draft {
  id: number;
  session_id: string;
  base_resume_id: number;
  status: "drafting" | "approved" | "applied";
  starting_source: "base" | "tailored";
  job_description: string | null;
  cover_letter: string | null;
  sections: DraftSection[];
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface Application {
  id: number;
  session_id: string;
  status: string;
  company_name: string | null;
  role_title: string | null;
  portal_url: string | null;
  job_board: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Autofill
// ---------------------------------------------------------------------------

export type BlockerType = "file_upload" | "captcha" | "otp" | "agreement" | "submit_confirmation";
export type FileUploadBlockerSubType = "resume" | "cover_letter" | "generic";
export type FileUploadBlockerDecision = "resolved_by_user" | "skipped_by_user";

export interface FormBlocker {
  type: BlockerType;
  selector: string;
  label: string;
  subType?: FileUploadBlockerSubType | string;
  resolved: boolean;
}

export type AutofillStateType =
  | "intake"
  | "matching"
  | "preview"
  | "apply"
  | "validate"
  | "navigate"
  | "blocked"
  | "complete"
  | "stopped";

export interface ValidationErrorItem {
  message: string;
  fieldSelector?: string;
  fieldLabel?: string;
  value?: string;
}

export interface AutofillProgress {
  state: AutofillStateType;
  total: number;
  filled: number;
  manual: number;
  skipped: number;
  currentField: string | null;
  currentAction: string | null;
  paused: boolean;
  completed: boolean;
  sessionComplete: boolean;
  stepIndex: number;
  fields: unknown[];
  activeBlocker: FormBlocker | null;
  validationErrors: ValidationErrorItem[];
  lastFilledField: { selector: string; label: string } | null;
  previewSummary?: { total: number; willFill: string[]; unknownCount: number };
}

// ---------------------------------------------------------------------------
// Workflow context
// ---------------------------------------------------------------------------

export interface AutofillContext {
  mode: "standard" | "direct";
  considerResume: boolean;
  hasStoredResume: boolean;
  suppressWorkAndSkills: boolean;
  applicationResumeSource: "profile_resume" | "temporary_resume" | null;
  temporaryResumeId: number | null;
  temporaryResumeFilename: string | null;
  pendingCoverLetterGeneration: boolean;
  pendingCoverLetterBlockerSelector: string | null;
  pendingUploadSubtype: FileUploadBlockerSubType | null;
  uploadedSameAsProfileResume: boolean;
}

// ---------------------------------------------------------------------------
// Autofill - Multi-page Session
// ---------------------------------------------------------------------------

export interface AutofillSession {
  active: boolean;
  tabId: number;
  startedAt: number;
  filledFieldTypes: string[];
  resumeFileUploaded: boolean;
  pagesVisited: string[];
  suppressWorkAndSkills: boolean;
  totalFilledAcrossPages: number;
  totalSkippedAcrossPages: number;
  totalManualAcrossPages: number;
}

// ---------------------------------------------------------------------------
// Extension pages / navigation
// ---------------------------------------------------------------------------

export type PageId =
  | "login"
  | "profile-setup"
  | "job-description"
  | "resume-select"
  | "temporary-resume-upload"
  | "section-editor"
  | "cover-letter"
  | "autofill";
