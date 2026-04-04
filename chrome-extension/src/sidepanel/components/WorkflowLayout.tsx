import type { ReactNode } from "react";
import { useAppStore } from "../store";
import AccountMenu from "./AccountMenu";
import {
  WORKFLOW_STEPS,
  canNavigateToWorkflowStep,
  navigateToWorkflowStep,
  pageToWorkflowStepIndex,
  type WorkflowStepIndex,
} from "../workflowNavigation";

interface WorkflowLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** When false, only renders brand header (no step rail). */
  showWorkflowChrome?: boolean;
  /** Hide the default title/subtitle block (e.g. when the page renders its own heading). */
  hideTitleSection?: boolean;
  /** Hide the top brand bar (e.g. autofill page full chrome). */
  hideHeader?: boolean;
}

export default function WorkflowLayout({
  title,
  subtitle,
  children,
  footer,
  showWorkflowChrome = true,
  hideTitleSection = false,
  hideHeader = false,
}: WorkflowLayoutProps) {
  const { currentPage, setPage, draft, autofillContext } = useAppStore();
  const stepIndex = pageToWorkflowStepIndex(currentPage);
  const isDirectMode = autofillContext.mode === "direct";

  const handleStepClick = (i: number) => {
    if (stepIndex === null) return;
    if (!canNavigateToWorkflowStep(i, stepIndex, isDirectMode)) return;
    navigateToWorkflowStep(i as WorkflowStepIndex, { setPage, draft });
  };

  return (
    <div className="flex flex-col h-screen bg-wf-bg text-wf-text antialiased">
      {!hideHeader && (
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-wf-border bg-wf-surface">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded bg-primary-500 shrink-0" aria-hidden />
            <span className="text-sm font-semibold text-wf-text truncate">AI Job Assistant</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <AccountMenu />
          </div>
        </header>
      )}

      {showWorkflowChrome && stepIndex !== null && (
        <WorkflowStepRail
          currentIndex={stepIndex}
          isDirectMode={isDirectMode}
          onStepClick={handleStepClick}
        />
      )}

      {!hideTitleSection && (
        <div className="shrink-0 px-4 pt-3 pb-1">
          <h1 className="text-lg font-bold text-wf-text leading-tight">{title}</h1>
          {subtitle && <p className="text-xs text-wf-muted mt-1">{subtitle}</p>}
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">{children}</div>

      {footer && (
        <footer className="shrink-0 px-4 py-3 border-t border-wf-border bg-wf-bg space-y-2">{footer}</footer>
      )}
    </div>
  );
}

function WorkflowStepRail({
  currentIndex,
  isDirectMode,
  onStepClick,
}: {
  currentIndex: number;
  isDirectMode: boolean;
  onStepClick: (i: number) => void;
}) {
  return (
    <div className="shrink-0 px-4 pt-3 pb-1">
      <div className="flex items-center w-full">
        {WORKFLOW_STEPS.map((label, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const navigable = canNavigateToWorkflowStep(i, currentIndex, isDirectMode);
          const skippedVisual = isDirectMode && i < 3 && currentIndex === 3;
          const lineDone = i < currentIndex && !isDirectMode;

          return (
            <div
              key={label}
              className={`flex items-center min-w-0 ${i < WORKFLOW_STEPS.length - 1 ? "flex-1" : ""}`}
            >
              <div className="flex flex-col items-center shrink-0">
                <button
                  type="button"
                  onClick={() => navigable && onStepClick(i)}
                  disabled={!navigable}
                  title={
                    navigable
                      ? `Go back to ${label}`
                      : skippedVisual
                        ? "Skipped in direct autofill"
                        : undefined
                  }
                  className={[
                    "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold border transition-transform",
                    skippedVisual && !active
                      ? "bg-wf-surface border-wf-border text-wf-dim"
                      : done
                        ? "bg-primary-500 border-primary-500 text-white"
                        : active
                          ? "bg-primary-500 border-primary-500 text-white"
                          : "bg-wf-surface border-wf-border text-wf-dim",
                    navigable
                      ? "cursor-pointer outline outline-1 outline-dashed outline-wf-borderBright outline-offset-2 hover:scale-110"
                      : "cursor-default",
                  ].join(" ")}
                >
                  {skippedVisual && !active ? "—" : done ? "✓" : i + 1}
                </button>
                <span
                  className={[
                    "mt-1 text-[11px] text-center max-w-[76px] leading-tight",
                    active ? "text-primary-500 font-semibold" : "text-wf-muted font-normal",
                    navigable ? "cursor-pointer underline decoration-dotted underline-offset-2" : "",
                  ].join(" ")}
                  onClick={() => navigable && onStepClick(i)}
                  role={navigable ? "button" : undefined}
                >
                  {label}
                </span>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <div
                  className={[
                    "h-[2px] flex-1 mx-1 mb-4 rounded-full min-w-[6px]",
                    lineDone ? "bg-primary-500" : "bg-wf-border",
                  ].join(" ")}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
      {isDirectMode && currentIndex === 3 && (
        <p className="text-[10px] text-wf-muted mt-2 px-0.5 leading-snug">
          Direct autofill: tailoring steps were skipped. Use Back or finish and start a new application for the full
          workflow.
        </p>
      )}
    </div>
  );
}
