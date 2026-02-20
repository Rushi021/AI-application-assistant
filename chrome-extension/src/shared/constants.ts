/** Backend API base URL. Change in production. */
export const API_BASE_URL = "http://localhost:8000";

/** Chrome storage keys */
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token",
  SESSION_ID: "session_id",
  USER_PROFILE: "user_profile",
  FIELD_MAPPINGS: "autofill_field_mappings",
  /** Optional: URL to fetch resume file for programmatic file input fill (set by side panel when available). */
  RESUME_FILE_URL: "autofill_resume_file_url",
} as const;

/** Message types for communication between extension parts */
export const MSG = {
  // Auth
  GET_AUTH_TOKEN: "GET_AUTH_TOKEN",
  AUTH_STATE_CHANGED: "AUTH_STATE_CHANGED",

  // Autofill
  START_AUTOFILL: "START_AUTOFILL",
  STOP_AUTOFILL: "STOP_AUTOFILL",
  AUTOFILL_PROGRESS: "AUTOFILL_PROGRESS",
  AUTOFILL_PAUSED: "AUTOFILL_PAUSED",
  AUTOFILL_RESUME: "AUTOFILL_RESUME",
  AUTOFILL_BLOCKER_RESOLVED: "AUTOFILL_BLOCKER_RESOLVED",
  AUTOFILL_UNDO: "AUTOFILL_UNDO",
  AUTOFILL_UNDO_ALL: "AUTOFILL_UNDO_ALL",
  AUTOFILL_CONFIRM_SUBMIT: "AUTOFILL_CONFIRM_SUBMIT",
  AUTOFILL_COMPLETE: "AUTOFILL_COMPLETE",
  AUTOFILL_FIELD_MANUAL: "AUTOFILL_FIELD_MANUAL",

  // Profile
  GET_USER_PROFILE: "GET_USER_PROFILE",

  // Content script
  DETECT_JOB_DESCRIPTION: "DETECT_JOB_DESCRIPTION",
  JOB_DESCRIPTION_DETECTED: "JOB_DESCRIPTION_DETECTED",
} as const;
