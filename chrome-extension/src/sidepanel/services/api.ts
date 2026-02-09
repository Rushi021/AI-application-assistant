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

export async function devLogin(email: string, fullName: string = ""): Promise<AuthTokens> {
  const resp = await fetch(`${API_BASE_URL}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName }),
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp.json();
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

export async function uploadResume(file: File): Promise<Resume> {
  const formData = new FormData();
  formData.append("file", file);
  return request<Resume>("/resumes/upload", { method: "POST", body: formData });
}

export async function listResumes(): Promise<Resume[]> {
  return request<Resume[]>("/resumes");
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

export async function applyAllSections(draftId: number): Promise<Blob> {
  const { accessToken, sessionId } = await getStoredTokens();
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (sessionId) headers["X-Session-Id"] = sessionId;

  const resp = await fetch(`${API_BASE_URL}/drafts/${draftId}/apply-all`, {
    method: "POST",
    headers,
  });
  if (!resp.ok) throw new ApiError(resp.status, await resp.text());
  return resp.blob();
}

export async function getSectionHistory(draftId: number, sectionId: string): Promise<ChatMessage[]> {
  return request<ChatMessage[]>(`/drafts/${draftId}/sections/${sectionId}/history`);
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

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
