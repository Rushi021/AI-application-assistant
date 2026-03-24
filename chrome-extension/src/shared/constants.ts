/** Backend API base URL. Change in production. */
export const API_BASE_URL = "http://localhost:8000";

/** Chrome storage keys */
export const STORAGE_KEYS = {
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token",
  SESSION_ID: "session_id",
  USER_PROFILE: "user_profile",
  AUTOFILL_PROGRESS: "autofill_progress",
  /** Multi-page autofill session state (chrome.storage.session). */
  AUTOFILL_SESSION: "autofill_session",
  /** Flat answer map used by content-script-owned autofill loop (chrome.storage.session). */
  AUTOFILL_ANSWERS: "autofill_answers",
  /** One-way content-script trigger stamp (chrome.storage.session). */
  AUTOFILL_TRIGGER_TS: "autofill_trigger_ts",
  /** Upload blocker decisions keyed by selector/subType (chrome.storage.session). */
  AUTOFILL_UPLOAD_DECISIONS: "autofill_upload_decisions",
} as const;

/** Message types for communication between extension parts */
export const MSG = {
  // Auth
  GET_AUTH_TOKEN: "GET_AUTH_TOKEN",
  AUTH_STATE_CHANGED: "AUTH_STATE_CHANGED",

  // Autofill lifecycle
  START_AUTOFILL: "START_AUTOFILL",
  STOP_AUTOFILL: "STOP_AUTOFILL",
  AUTOFILL_PROGRESS: "AUTOFILL_PROGRESS",
  AUTOFILL_DIAG_TRACE: "AUTOFILL_DIAG_TRACE",
  AUTOFILL_START_RESULT: "AUTOFILL_START_RESULT",
  AUTOFILL_UPLOAD_BLOCKER_DECISION: "AUTOFILL_UPLOAD_BLOCKER_DECISION",

  // Multi-page session
  AUTOFILL_SESSION_STARTED: "AUTOFILL_SESSION_STARTED",
  AUTOFILL_SESSION_CHECK: "AUTOFILL_SESSION_CHECK",
  AUTOFILL_SESSION_UPDATE: "AUTOFILL_SESSION_UPDATE",
  AUTOFILL_SESSION_CANCEL: "AUTOFILL_SESSION_CANCEL",
  RUN_DIRECT_AUTOFILL: "RUN_DIRECT_AUTOFILL",

  // Profile
  GET_USER_PROFILE: "GET_USER_PROFILE",
} as const;
