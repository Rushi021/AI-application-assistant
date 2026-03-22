import type { Draft, PageId } from "@/shared/types";

export const WORKFLOW_STEPS = ["Job", "Resume", "Edit", "Autofill"] as const;

export type WorkflowStepIndex = 0 | 1 | 2 | 3;

export function pageToWorkflowStepIndex(page: PageId): WorkflowStepIndex | null {
  switch (page) {
    case "job-description":
      return 0;
    case "resume-select":
    case "temporary-resume-upload":
      return 1;
    case "section-editor":
    case "cover-letter":
      return 2;
    case "autofill":
      return 3;
    default:
      return null;
  }
}

/**
 * Matches the reference wizard: limited back-navigation via the step rail
 * (Job is not reachable from the dots after step 0; Resume step disables dots).
 */
export function canNavigateToWorkflowStep(
  targetIndex: number,
  currentIndex: number,
  isDirectMode: boolean
): boolean {
  if (isDirectMode) return false;
  if (targetIndex >= currentIndex) return false;
  if (currentIndex === 1) return false;
  if (currentIndex === 2) return targetIndex === 1;
  if (currentIndex === 3) return targetIndex === 1 || targetIndex === 2;
  return false;
}

export function navigateToWorkflowStep(
  targetIndex: WorkflowStepIndex,
  opts: {
    setPage: (p: PageId) => void;
    draft: Draft | null;
  }
): void {
  switch (targetIndex) {
    case 0:
      opts.setPage("job-description");
      return;
    case 1:
      opts.setPage("resume-select");
      return;
    case 2:
      opts.setPage(opts.draft ? "section-editor" : "resume-select");
      return;
    default:
      return;
  }
}
