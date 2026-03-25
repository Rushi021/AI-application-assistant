/**
 * Keeps the original resume File in memory for the side-panel session so we can
 * POST it with apply-all without storing the blob on the server (client_stored uploads).
 */

const resumeFileById = new Map<number, File>();

export function rememberResumeFile(resumeId: number, file: File): void {
  resumeFileById.set(resumeId, file);
}

export function getCachedResumeFile(resumeId: number): File | undefined {
  return resumeFileById.get(resumeId);
}

export function forgetResumeFile(resumeId: number): void {
  resumeFileById.delete(resumeId);
}

export function clearResumeFileCache(): void {
  resumeFileById.clear();
}
