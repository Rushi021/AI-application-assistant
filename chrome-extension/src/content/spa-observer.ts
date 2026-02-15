/**
 * SPA observation: passive form monitor and post-navigation waiter.
 * Tool A: MutationObserver (debounced, continuous).
 * Tool B: Polling loop with step fingerprint (only after Next/Continue).
 */

import type { FormModel } from "@/shared/types";

const FORM_TAGS = ["input", "select", "textarea", "form"];
const FORM_SELECTOR = "input, select, textarea, form, [role='form']";

function nodeContainsFormElement(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  const tag = el.tagName?.toLowerCase();
  if (FORM_TAGS.includes(tag)) return true;
  if (el.getAttribute?.("role") === "form") return true;
  return el.querySelector?.(FORM_SELECTOR) != null;
}

function mutationHasFormElements(mutations: MutationRecord[]): boolean {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (nodeContainsFormElement(n)) return true;
    }
  }
  return false;
}

/**
 * Tool A: Passive page monitor. Watches document.body for form elements.
 * Debounced 300ms. Returns cleanup function.
 */
export function startPassiveFormMonitor(onFormChange: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 300;

  const observer = new MutationObserver((mutations) => {
    if (!mutationHasFormElements(mutations)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onFormChange();
    }, DEBOUNCE_MS);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    const docObserver = new MutationObserver(() => {
      if (document.body) {
        docObserver.disconnect();
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
    docObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    observer.disconnect();
  };
}

/**
 * Compute stable fingerprint for current form step.
 */
export function computeStepFingerprint(model: FormModel): string {
  const parts = model.fields
    .map((f) => `${f.fieldType}|${f.selector}|${f.label}`)
    .sort();
  return parts.join("\n");
}

const VALIDATION_SELECTORS = [
  '[aria-invalid="true"]',
  '[class*="error"]',
  '[class*="invalid"]',
  '[role="alert"]',
  ".error-message",
  ".field-error",
  ".invalid-feedback",
];

function hasNewlyVisibleErrors(): boolean {
  for (const sel of VALIDATION_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
  }
  return false;
}

export type StepChangeResult = "new_step" | "validation_error" | "stuck";

/**
 * Tool B: Post-navigation waiter. Polls every 200ms.
 * Returns when: fingerprint changed (new_step), new errors (validation_error), route changed (new_step), or timeout (stuck).
 */
export async function waitForStepChange(
  buildModel: () => FormModel,
  previousFingerprint: string,
  timeoutMs = 5000,
  initialUrl = location.href
): Promise<StepChangeResult> {
  const POLL_MS = 200;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    if (location.href !== initialUrl) {
      return "new_step";
    }

    const model = buildModel();
    const currentFingerprint = computeStepFingerprint(model);
    const hasErrors = hasNewlyVisibleErrors();

    if (hasErrors && currentFingerprint === previousFingerprint) {
      return "validation_error";
    }
    if (currentFingerprint !== previousFingerprint && !hasErrors) {
      return "new_step";
    }
  }

  return "stuck";
}

/**
 * Patch history API to detect SPA route changes. Calls onRouteChange (debounced 500ms).
 * Returns cleanup function.
 */
export function patchHistoryAPI(onRouteChange: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 500;

  const schedule = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onRouteChange();
    }, DEBOUNCE_MS);
  };

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    origPush(...args);
    schedule();
  };
  history.replaceState = function (...args) {
    origReplace(...args);
    schedule();
  };
  window.addEventListener("popstate", schedule);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener("popstate", schedule);
  };
}
