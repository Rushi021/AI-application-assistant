import { API_BASE_URL, STORAGE_KEYS } from "@/shared/constants";
import {
  getUnsynced,
  markSynced,
  incrementRetry,
  cleanup,
} from "@/utils/pending-queue";

const ALARM_NAME = "sync-pending-applications";

export function registerSyncAlarm(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

export function initSyncAlarmListener(): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    await syncPendingApplications();
  });
}

async function tryRefreshAccessToken(): Promise<string | null> {
  const data = await chrome.storage.local.get([STORAGE_KEYS.REFRESH_TOKEN]);
  const refreshToken = data[STORAGE_KEYS.REFRESH_TOKEN];
  if (!refreshToken) return null;
  try {
    const resp = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const nextToken =
      json && typeof json === "object" && "access_token" in json
        ? String((json as { access_token: unknown }).access_token ?? "")
        : "";
    if (!nextToken) return null;
    await chrome.storage.local.set({ [STORAGE_KEYS.ACCESS_TOKEN]: nextToken });
    return nextToken;
  } catch {
    return null;
  }
}

export async function syncPendingApplications(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.SESSION_ID,
  ]);

  let accessToken: string | undefined = stored[STORAGE_KEYS.ACCESS_TOKEN];
  const sessionId: string | undefined = stored[STORAGE_KEYS.SESSION_ID];

  if (!accessToken || !sessionId) return;

  const unsynced = await getUnsynced();
  if (unsynced.length === 0) {
    await cleanup();
    return;
  }

  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Session-Id": sessionId,
  });

  for (const record of unsynced) {
    try {
      let resp = await fetch(`${API_BASE_URL}/applications`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          job_id: record.job_id,
          resume_id: record.resume_id,
          status: record.status,
          company_name: record.company_name,
          role_title: record.role_title,
          portal_url: record.portal_url,
          job_board: record.job_board,
          salary: record.salary,
          resume_filename: record.resume_filename,
          resume_source: record.resume_source,
          cover_letter: record.cover_letter,
        }),
      });

      if (resp.status === 401) {
        const refreshed = await tryRefreshAccessToken();
        if (!refreshed) break;
        accessToken = refreshed;
        resp = await fetch(`${API_BASE_URL}/applications`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            job_id: record.job_id,
            resume_id: record.resume_id,
            status: record.status,
            company_name: record.company_name,
            role_title: record.role_title,
            portal_url: record.portal_url,
            job_board: record.job_board,
            salary: record.salary,
            resume_filename: record.resume_filename,
            resume_source: record.resume_source,
            cover_letter: record.cover_letter,
          }),
        });
        if (resp.status === 401) break;
      }

      if (!resp.ok) {
        await incrementRetry(
          record.local_id,
          `HTTP ${resp.status}: ${resp.statusText}`,
        );
        continue;
      }

      const application = await resp.json();
      await markSynced(record.local_id, application.id);

      // Fire-and-forget: log a tracking_created event
      try {
        await fetch(
          `${API_BASE_URL}/applications/${application.id}/events`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
              event_type: "tracking_created",
              detail: JSON.stringify({
                source: "extension_done_button",
                tracked_from: "chrome_extension",
                detected_at: record.applied_at,
              }),
            }),
          },
        );
      } catch {
        // Event logging is best-effort; application is already saved
      }
    } catch (err) {
      await incrementRetry(
        record.local_id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await cleanup();
}
