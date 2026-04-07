import type { PendingApplication } from "@/shared/pending-application";

const STORAGE_KEY = "pending_applications";
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETRIES = 10;

async function readQueue(): Promise<PendingApplication[]> {
  const { pending_applications = [] } =
    await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(pending_applications) ? pending_applications : [];
}

async function writeQueue(queue: PendingApplication[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: queue });
}

export async function enqueue(app: PendingApplication): Promise<void> {
  try {
    const queue = await readQueue();

    const duplicateIdx = queue.findIndex(
      (existing) =>
        existing.portal_url === app.portal_url &&
        Date.now() - new Date(existing.applied_at).getTime() < DEDUP_WINDOW_MS,
    );

    if (duplicateIdx !== -1) {
      queue[duplicateIdx] = { ...app, local_id: queue[duplicateIdx].local_id };
    } else {
      queue.push(app);
    }

    await writeQueue(queue);
  } catch (err) {
    console.error("[pending-queue] enqueue failed:", err);
  }
}

export async function getUnsynced(): Promise<PendingApplication[]> {
  try {
    const queue = await readQueue();
    return queue.filter((r) => !r.synced && r.retry_count < MAX_RETRIES);
  } catch (err) {
    console.error("[pending-queue] getUnsynced failed:", err);
    return [];
  }
}

export async function markSynced(
  localId: string,
  backendId: number,
): Promise<void> {
  try {
    const queue = await readQueue();
    const record = queue.find((r) => r.local_id === localId);
    if (record) {
      record.synced = true;
      record.backend_id = backendId;
      await writeQueue(queue);
    }
  } catch (err) {
    console.error("[pending-queue] markSynced failed:", err);
  }
}

export async function incrementRetry(
  localId: string,
  error: string,
): Promise<void> {
  try {
    const queue = await readQueue();
    const record = queue.find((r) => r.local_id === localId);
    if (record) {
      record.retry_count += 1;
      record.last_error = error;
      await writeQueue(queue);
    }
  } catch (err) {
    console.error("[pending-queue] incrementRetry failed:", err);
  }
}

export async function cleanup(): Promise<void> {
  try {
    const queue = await readQueue();
    const now = Date.now();

    const kept = queue.filter((r) => {
      const age = now - new Date(r.applied_at).getTime();
      if (r.synced && age > SYNCED_RETENTION_MS) return false;
      if (r.retry_count >= MAX_RETRIES && age > FAILED_RETENTION_MS) return false;
      return true;
    });

    if (kept.length !== queue.length) {
      await writeQueue(kept);
    }
  } catch (err) {
    console.error("[pending-queue] cleanup failed:", err);
  }
}
