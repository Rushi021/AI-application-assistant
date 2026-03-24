/**
 * Best-effort company slug from job description text for download filenames.
 */
export function companySlugFromJobText(jobText: string | null | undefined): string | null {
  const raw = (jobText ?? "").trim();
  if (!raw) return null;

  const lines = raw.split(/\r?\n/);
  const labelRe = /^(company|employer|organization|organisation)\s*:\s*(.+)$/i;

  for (const line of lines) {
    const m = line.trim().match(labelRe);
    if (m?.[2]) {
      const slug = sanitizeFilenameSegment(m[2]);
      return slug || null;
    }
  }

  return null;
}

function sanitizeFilenameSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "";
}

/**
 * Anchor download for a Blob (extension side panel; no chrome.downloads).
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function tailoredResumeFilename(companySlug: string | null): string {
  return companySlug ? `Tailored_Resume_${companySlug}.docx` : "Tailored_Resume.docx";
}

export function coverLetterFilename(companySlug: string | null): string {
  return companySlug ? `Cover_Letter_${companySlug}.docx` : "Cover_Letter.docx";
}
