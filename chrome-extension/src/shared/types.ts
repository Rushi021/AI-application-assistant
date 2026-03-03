// ---------------------------------------------------------------------------
// User / Auth
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: number;
  username: string;
  email: string | null;
  picture_url: string | null;

  // Basic
  full_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;

  // Professional
  linkedin_url: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  years_of_experience: number | null;
  current_title: string | null;
  current_company: string | null;

  // Education
  degree: string | null;
  field_of_study: string | null;
  university: string | null;
  graduation_year: number | null;
  gpa: number | null;

  // Work authorization
  visa_status: string | null;
  work_authorization: string | null;
  sponsorship_needed: boolean | null;

  // Demographics (EEO)
  gender: string | null;
  ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;

  // Salary
  expected_salary: string | null;
  current_salary: string | null;
  salary_currency: string | null;

  // Custom
  custom_fields: Record<string, unknown> | null;
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
  content_type: string;
  size_bytes: number;
  created_at: string;
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
// Autofill - Form Model (State A: Page Intake)
// ---------------------------------------------------------------------------

export type ConfidenceTier = "A" | "B" | "C";

export type FieldKind = "native" | "custom_select" | "contenteditable";

export interface FormField {
  selector: string;
  fieldType: string;
  label: string;
  fieldKind?: FieldKind;
  triggerSelector?: string;
  /** name, id, placeholder, aria-label, autocomplete, data-testid */
  signals: string[];
  /** (source, value) for weighted scoring. Sources: autocomplete, type, name, id, placeholder, aria-label, label, nearby, required, pattern, minLength, maxLength */
  signalsWithSource?: Array<{ source: string; value: string }>;
  required: boolean;
  visible: boolean;
  enabled: boolean;
  filled: boolean;
  manual: boolean;
  /** Populated after matching; null = no match or low confidence */
  profileValue: string | null;
  confidence: number;
  confidenceTier: ConfidenceTier;
  /** Section/step if detectable (e.g. "Personal Info", "Experience") */
  section: string | null;
  /** Why this field matched (e.g. "autocomplete:email", "label:first_name", "platform:greenhouse") */
  matchReason?: string;
  /** Logical group (address, name, phone) for atomic fill */
  groupId?: string | null;
}

export interface FormAction {
  type: "next" | "submit" | "continue";
  selector: string;
  label: string;
}

export type BlockerType = "file_upload" | "captcha" | "otp" | "agreement" | "submit_confirmation";
export type FileUploadBlockerSubType = "resume" | "cover_letter" | "generic";
export type FileUploadBlockerDecision = "resolved_by_user" | "skipped_by_user";

export interface FormBlocker {
  type: BlockerType;
  selector: string;
  label: string;
  /** For file_upload: resume | cover_letter | generic */
  subType?: FileUploadBlockerSubType | string;
  resolved: boolean;
}

export interface FormModel {
  fields: FormField[];
  actions: FormAction[];
  blockers: FormBlocker[];
  /** Section/step grouping if detectable */
  sections: string[];
}

// ---------------------------------------------------------------------------
// Autofill - State Machine
// ---------------------------------------------------------------------------

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

/** One validation error with optional field context for side panel and highlight */
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
  /** Current step index for multi-step forms */
  stepIndex: number;
  /** Detected fields with confidence (for UI preview) */
  fields: FormField[];
  /** Active blocker when state=blocked */
  activeBlocker: FormBlocker | null;
  /** Validation errors after fill (field + value for reporting/highlight) */
  validationErrors: ValidationErrorItem[];
  /** Last filled field for UI display; previousValue kept only in content script for Undo */
  lastFilledField: { selector: string; label: string } | null;
  /** Pre-fill preview: field labels we will fill; unknown count */
  previewSummary?: { total: number; willFill: string[]; unknownCount: number };
}

// Legacy compatibility — keep DetectedField for any external references
export interface DetectedField {
  selector: string;
  fieldType: string;
  label: string;
  confidence: number;
  value?: string;
  filled: boolean;
  manual: boolean;
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
