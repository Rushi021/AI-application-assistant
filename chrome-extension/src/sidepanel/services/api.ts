/**
 * Backend API client for the Chrome extension.
 * All requests include JWT auth and session headers.
 */

import { API_BASE_URL, STORAGE_KEYS } from "@/shared/constants";
import type {
  AuthTokens,
  Application,
  Draft,
  Job,
  PipelineRun,
  Resume,
  ResumeScore,
  UserProfile,
  ChatMessage,
} from "@/shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getStoredTokens(): Promise<{ accessToken: string | null; sessionId: string | null }> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.SESSION_ID]);
  return {
    accessToken: result[STORAGE_KEYS.ACCESS_TOKEN] ?? null,
    sessionId: result[STORAGE_KEYS.SESSION_ID] ?? null,
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { accessToken, sessionId } = await getStoredTokens();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (sessionId) headers["X-Session-Id"] = sessionId;

  // Only set Content-Type for non-FormData bodies
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const resp = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (resp.status === 401) {
    // Try refresh
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${refreshed}`;
      const retryResp = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
      if (!retryResp.ok) throw new ApiError(retryResp.status, await retryResp.text());
      return retryResp.json();
    }
    throw new ApiError(401, "Authentication required");
  }

  if (!resp.ok) {
    throw new ApiError(resp.status, await resp.text());
  }

  // Handle empty responses
  const text = await resp.text();
  if (!text) return {} as T;
  return JSON.parse(text);
}

async function tryRefreshToken(): Promise<string | null> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN]);
  const refreshToken = result[STORAGE_KEYS.REFRESH_TOKEN];
  if (!refreshToken) return null;

  try {
    const resp = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    await chrome.storage.local.set({ [STORAGE_KEYS.ACCESS_TOKEN]: data.access_token });
    return data.access_token;
  } catch {
    return null;
  }
}

/** Authenticated fetch returning a Blob, with 401 refresh retry (same as request()). */
async function fetchWithAuthBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const { accessToken, sessionId } = await getStoredTokens();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (sessionId) headers["X-Session-Id"] = sessionId;
  const hasBody = options.body != null && options.body !== "";
  if (hasBody && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const url = `${API_BASE_URL}${path}`;
  let resp = await fetch(url, { ...options, headers });

  if (resp.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${refreshed}`;
      resp = await fetch(url, { ...options, headers });
    } else {
      throw new ApiError(401, "Authentication required");
    }
  }

  if (!resp.ok) {
    throw new ApiError(resp.status, await resp.text());
  }
  return resp.blob();
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function authGoogle(token: string, tokenType: "id_token" | "access_token" = "access_token"): Promise<AuthTokens> {
  const resp = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, token_type: tokenType }),
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp.json();
}

/** Exchange Google auth code from chrome.identity.launchWebAuthFlow (no JWT yet). */
export async function exchangeExtensionGoogleCode(code: string, redirectUri: string): Promise<AuthTokens> {
  const resp = await fetch(`${API_BASE_URL}/auth/extension/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp.json();
}

/** One-time code to open the web app with the same account (JWT → short-lived code, max 60s TTL on server). */
export async function createWebBridgeCode(): Promise<string> {
  const data = await request<{ code: string }>("/auth/web/bridge", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.code;
}

export async function getMe(): Promise<UserProfile> {
  return request<UserProfile>("/auth/me");
}

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<UserProfile> {
  return request<UserProfile>("/users/me/profile");
}

export async function updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  return request<UserProfile>("/users/me/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function replaceProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  return request<UserProfile>("/users/me/profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

/**
 * @param clientStored When true (default), the API stores only parsed structure — not the file on disk.
 *   The extension must cache the File (see resumeLocalCache) for apply-all.
 */
export async function uploadResume(file: File, clientStored = true): Promise<Resume> {
  const formData = new FormData();
  formData.append("file", file);
  const q = clientStored ? "?client_stored=true" : "";
  return request<Resume>(`/resumes/upload${q}`, { method: "POST", body: formData });
}

export async function listResumes(): Promise<Resume[]> {
  return request<Resume[]>("/resumes");
}

export async function deleteResume(resumeId: number): Promise<void> {
  return request<void>(`/resumes/${resumeId}?force=true`, { method: "DELETE" });
}

export async function scoreResumes(jobDescription: string, resumeIds?: number[]): Promise<ResumeScore[]> {
  const body: Record<string, unknown> = { job_description: jobDescription };
  if (resumeIds) body.resume_ids = resumeIds;
  // Backend returns { scores: [...] }, unwrap it
  const resp = await request<{ scores: ResumeScore[] }>("/resumes/score", { method: "POST", body: JSON.stringify(body) });
  return resp.scores ?? [];
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function ingestJob(rawText: string): Promise<Job> {
  return request<Job>("/jobs/ingest", {
    method: "POST",
    body: JSON.stringify({ raw_text: rawText }),
  });
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(params: {
  job_description: string;
  resume_id?: number;
  resume_text?: string;
  tailor_instructions?: string;
  cover_letter_instructions?: string;
}): Promise<PipelineRun> {
  return request<PipelineRun>("/pipeline/run", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getPipelineRun(runId: number): Promise<PipelineRun> {
  return request<PipelineRun>(`/pipeline/runs/${runId}`);
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function createDraft(params: {
  resume_id: number;
  run_id?: number;
  starting_source?: "base" | "tailored";
  job_description?: string;
}): Promise<Draft> {
  // Backend expects 'base_resume_id', not 'resume_id'
  const body = {
    base_resume_id: params.resume_id,
    run_id: params.run_id,
    starting_source: params.starting_source,
    job_description: params.job_description,
  };
  return request<Draft>("/drafts", { method: "POST", body: JSON.stringify(body) });
}

export async function getDraft(draftId: number): Promise<Draft> {
  return request<Draft>(`/drafts/${draftId}`);
}

export async function chatSection(draftId: number, sectionId: string, message: string): Promise<{ proposed_text: string }> {
  return request<{ proposed_text: string }>(`/drafts/${draftId}/sections/${sectionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function patchSection(draftId: number, sectionId: string, currentText: string): Promise<void> {
  await request<void>(`/drafts/${draftId}/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify({ current_text: currentText }),
  });
}

export async function applySection(draftId: number, sectionId: string): Promise<void> {
  await request<void>(`/drafts/${draftId}/sections/${sectionId}/apply`, { method: "POST" });
}

/**
 * Rebuild the final .docx. Pass `resumeFile` when the resume was uploaded with client_stored=true
 * (default); omit when the API still has the file on server storage.
 */
export async function applyAllSections(draftId: number, resumeFile?: File): Promise<Blob> {
  if (resumeFile) {
    const formData = new FormData();
    formData.append("resume_file", resumeFile, resumeFile.name);
    return fetchWithAuthBlob(`/drafts/${draftId}/apply-all`, { method: "POST", body: formData });
  }
  return fetchWithAuthBlob(`/drafts/${draftId}/apply-all`, { method: "POST" });
}

export async function renderCoverLetterDocx(draftId: number, coverLetter: string): Promise<Blob> {
  return fetchWithAuthBlob(`/drafts/${draftId}/cover-letter/docx`, {
    method: "POST",
    body: JSON.stringify({ cover_letter: coverLetter }),
  });
}

export async function generateCoverLetter(
  draftId: number,
  params?: { cover_letter_instructions?: string }
): Promise<{ cover_letter: string }> {
  return request<{ cover_letter: string }>(`/drafts/${draftId}/generate-cover-letter`, {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  });
}

export async function getSectionHistory(draftId: number, sectionId: string): Promise<ChatMessage[]> {
  return request<ChatMessage[]>(`/drafts/${draftId}/sections/${sectionId}/history`);
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/** Full payload for Done-track flow; `applied_at` is not sent in POST /applications (matches background sync body). */
export type TrackApplicationPayload = {
  portal_url: string;
  company_name: string | null;
  role_title: string | null;
  job_board: string | null;
  applied_at: string;
  status: "applied";
  job_id: number | null;
  resume_id: number | null;
  resume_filename: string | null;
  resume_source: string | null;
  cover_letter: string | null;
  salary: string | null;
};

/** POST /applications with the same JSON body as [sync.ts](chrome-extension/src/background/sync.ts) queue sync. */
export async function submitTrackedApplication(payload: TrackApplicationPayload): Promise<Application> {
  const body = {
    job_id: payload.job_id,
    resume_id: payload.resume_id,
    status: payload.status,
    company_name: payload.company_name,
    role_title: payload.role_title,
    portal_url: payload.portal_url,
    job_board: payload.job_board,
    salary: payload.salary,
    resume_filename: payload.resume_filename,
    resume_source: payload.resume_source,
    cover_letter: payload.cover_letter,
  };
  const application = await request<Application>("/applications", {
    method: "POST",
    body: JSON.stringify(body),
  });
  void logTrackingCreatedEvent(application.id, payload.applied_at);
  return application;
}

/** Best-effort parity with sync.ts post-create event (never throws). */
export async function logTrackingCreatedEvent(applicationId: number, appliedAtIso: string): Promise<void> {
  try {
    await request<void>(`/applications/${applicationId}/events`, {
      method: "POST",
      body: JSON.stringify({
        event_type: "tracking_created",
        detail: JSON.stringify({
          source: "extension_done_button",
          tracked_from: "chrome_extension",
          detected_at: appliedAtIso,
        }),
      }),
    });
  } catch {
    // Event logging is best-effort; application is already saved
  }
}

export async function createApplication(params: {
  company_name?: string;
  role_title?: string;
  portal_url?: string;
  job_board?: string;
  job_id?: number;
  resume_id?: number;
}): Promise<Application> {
  return request<Application>("/applications", { method: "POST", body: JSON.stringify(params) });
}

export async function logApplicationEvent(applicationId: number, eventType: string, detail?: string): Promise<void> {
  await request<void>(`/applications/${applicationId}/events`, {
    method: "POST",
    body: JSON.stringify({ event_type: eventType, detail }),
  });
}
