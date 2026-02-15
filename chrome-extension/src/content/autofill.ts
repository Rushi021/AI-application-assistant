/**
 * Content script: State-machine autofill for job application forms.
 *
 * State A: Page Intake — Build form model (fields, actions, blockers)
 * State B: Field → Profile Matching — Confidence-driven mapping
 * State C: Apply — Fill inputs (focus, set value, events)
 * State D: Validation — Check for inline errors
 * State E: Navigation — Click Next/Continue, loop
 * State F: Blockers — Pause for upload/CAPTCHA/OTP/agreement/submit
 */

import { MSG, STORAGE_KEYS } from "@/shared/constants";
import type {
  UserProfile,
  AutofillProgress,
  FormModel,
  FormField,
  FormBlocker,
  FormAction,
} from "@/shared/types";
import { buildFormModel } from "./form-model";
import { matchFieldsToProfile } from "./field-matcher";
import { detectPlatform } from "./adapters";
import { saveLearnedMapping, normalizeLabel } from "./site-learning";
import {
  computeStepFingerprint,
  waitForStepChange,
  startPassiveFormMonitor,
  patchHistoryAPI,
} from "./spa-observer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Random delay 30-80ms between fills to reduce bot detection */
function getInterFieldDelayMs(): number {
  return 30 + Math.random() * 50;
}

/** Placeholder values that should be treated as empty */
const PLACEHOLDER_PATTERNS = [
  /^\s*$/, // whitespace only
  /^select\s*$/i,
  /^choose\s*$/i,
  /^--\s*select\s*--\s*$/i,
  /^select\s+one\s*$/i,
  /^choose\s+one\s*$/i,
  /^please\s+select\s*$/i,
];

/** Abbreviations for select option matching (value -> display text) */
const SELECT_ABBREVIATIONS: Record<string, string[]> = {
  US: ["United States", "United States of America", "USA"],
  "United States": ["US", "USA", "United States of America"],
  UK: ["United Kingdom", "Great Britain"],
  "United Kingdom": ["UK", "GB", "Great Britain"],
  CA: ["California", "Canada"],
  California: ["CA"],
  Canada: ["CA"],
  NY: ["New York"],
  "New York": ["NY"],
  TX: ["Texas"],
  Texas: ["TX"],
  FL: ["Florida"],
  Florida: ["FL"],
  GA: ["Georgia"],
  Georgia: ["GA"],
};

function isValueEffectivelyEmpty(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed));
}

function valuesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Find best-matching option for a select. Order: exact value -> exact text -> case-insensitive includes -> abbreviation map.
 * Uses context (e.g. country) for disambiguation when multiple options match (e.g. CA = California vs Canada).
 */
function findBestSelectOption(
  select: HTMLSelectElement,
  value: string,
  countryContext?: string | null
): HTMLOptionElement | null {
  const options = Array.from(select.options).filter((o) => o.value);
  const valLower = value.trim().toLowerCase();
  const countryLower = countryContext?.trim().toLowerCase();

  // 1. Exact value match
  const exactValue = options.find((o) => o.value.toLowerCase() === valLower);
  if (exactValue) return exactValue;

  // 2. Exact text content match
  const exactText = options.find(
    (o) => o.textContent?.trim().toLowerCase() === valLower
  );
  if (exactText) return exactText;

  // 3. Case-insensitive includes
  const includes = options.filter(
    (o) =>
      o.value.toLowerCase().includes(valLower) ||
      o.textContent?.toLowerCase().includes(valLower)
  );

  if (includes.length === 0) {
    // 4. Abbreviation lookup
    const expanded = SELECT_ABBREVIATIONS[value.trim()] ?? [];
    for (const exp of expanded) {
      const found = options.find(
        (o) =>
          o.value.toLowerCase().includes(exp.toLowerCase()) ||
          o.textContent?.toLowerCase().includes(exp.toLowerCase())
      );
      if (found) return found;
    }
    return null;
  }

  if (includes.length === 1) return includes[0];

  // Disambiguation: use country context (e.g. US state vs Canada province)
  if (countryLower) {
    const isUS = /united\s*states|usa|us\b/.test(countryLower);
    const isCanada = /canada|ca\b/.test(countryLower);
    for (const opt of includes) {
      const text = opt.textContent?.toLowerCase() ?? "";
      if (isUS && (text.includes("california") || text.includes("new york") || text.includes("texas"))) return opt;
      if (isCanada && text.includes("canada")) return opt;
    }
  }

  return includes[0] ?? null;
}

const MAX_NAVIGATION_CLICKS = 20;
const MAX_LOOP_TIME_MS = 5 * 60 * 1000;

const VALIDATION_ERROR_SELECTORS = [
  '[class*="error"]',
  '[class*="invalid"]',
  '[aria-invalid="true"]',
  '[role="alert"]',
  '.error-message',
  '.invalid-feedback',
  '[data-error]',
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let stopped = false;

interface UndoEntry {
  element: HTMLElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  selector: string;
  previousValue: string;
  isCustomSelect: boolean;
}
let undoSnapshot: UndoEntry[] = [];

// ---------------------------------------------------------------------------
// DOM value setter (State C: Apply — triggers React/Angular/Vue)
// ---------------------------------------------------------------------------

function setFieldValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  countryContext?: string | null
): void {
  if (el instanceof HTMLSelectElement) {
    const match = findBestSelectOption(el, value, countryContext);
    if (match) {
      el.value = match.value;
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // Input / Textarea: native setter + fallback, then input + change + blur()
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  if (el instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(el, value);
  } else if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

function applyToField(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  countryContext?: string | null
): string {
  const previous = el.value ?? "";
  el.focus();
  setFieldValue(el, value, countryContext);
  return previous;
}

async function fillCustomDropdown(
  triggerEl: Element,
  value: string,
  _countryContext?: string | null
): Promise<string> {
  const previous =
    (triggerEl as HTMLInputElement).value ??
    triggerEl.textContent?.trim() ??
    "";

  (triggerEl as HTMLElement).click();
  await sleep(50);

  for (let i = 0; i < 10; i++) {
    await sleep(50);
    const options = document.querySelectorAll('[role="option"], [role="listbox"] [role="option"]');
    const valLower = value.toLowerCase();
    for (const opt of options) {
      const text = opt.textContent?.trim().toLowerCase();
      if (text?.includes(valLower) || valLower.includes(text ?? "")) {
        (opt as HTMLElement).click();
        await sleep(100);
        return previous;
      }
    }
  }

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return previous;
}

// ---------------------------------------------------------------------------
// State D: Validation — detect inline errors
// ---------------------------------------------------------------------------

function detectValidationErrors(): string[] {
  const errors: string[] = [];
  for (const sel of VALIDATION_ERROR_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      const text = el.textContent?.trim();
      if (text && text.length < 200) errors.push(text);
    });
  }
  return [...new Set(errors)];
}

// ---------------------------------------------------------------------------
// Overlay (Shadow DOM) — pause, blocker, field manual
// ---------------------------------------------------------------------------

let overlayHost: HTMLDivElement | null = null;

type OverlayConfig = {
  title: string;
  message: string;
  showCheckbox?: boolean;
  checkboxLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
};

function showOverlay(
  targetElement: Element | null,
  config: OverlayConfig,
  onContinue: () => void,
  onSkip?: () => void
): void {
  removeOverlay();

  overlayHost = document.createElement("div");
  overlayHost.id = "ai-assistant-overlay-host";
  document.body.appendChild(overlayHost);

  const shadow = overlayHost.attachShadow({ mode: "closed" });

  const styles = document.createElement("style");
  styles.textContent = `
    .overlay-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.15); z-index: 2147483646; }
    .overlay-card {
      position: fixed; z-index: 2147483647; background: white; border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15); padding: 16px; width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .overlay-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .overlay-icon { width: 24px; height: 24px; background: #FEF3C7; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
    .overlay-title-text { font-size: 14px; font-weight: 600; color: #1F2937; }
    .overlay-message { font-size: 12px; color: #6B7280; margin-bottom: 12px; padding: 6px 10px;
      background: #F9FAFB; border-radius: 6px; border: 1px solid #E5E7EB; }
    .overlay-checkbox-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
    .overlay-checkbox { width: 18px; height: 18px; accent-color: #F97316; cursor: pointer; }
    .overlay-checkbox-label { font-size: 13px; color: #374151; cursor: pointer; }
    .overlay-actions { display: flex; gap: 8px; margin-top: 12px; }
    .overlay-btn { flex: 1; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: none; transition: background 0.15s; }
    .overlay-btn-secondary { background: #F3F4F6; color: #6B7280; }
    .overlay-btn-secondary:hover { background: #E5E7EB; }
    .overlay-btn-primary { background: #F97316; color: white; }
    .overlay-btn-primary:hover { background: #EA580C; }
    .overlay-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .field-highlight { outline: 3px solid #F97316 !important; outline-offset: 2px;
      box-shadow: 0 0 0 6px rgba(249,115,22,0.15) !important; }
  `;

  const rect = targetElement?.getBoundingClientRect() ?? { bottom: 100, left: 20 };
  const cardTop = Math.min(rect.bottom + 8, window.innerHeight - 220);
  const cardLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 340));

  const card = document.createElement("div");
  card.className = "overlay-card";
  card.style.top = `${cardTop}px`;
  card.style.left = `${cardLeft}px`;

  const checkboxHtml =
    config.showCheckbox && config.checkboxLabel
      ? `
    <div class="overlay-checkbox-row">
      <input type="checkbox" class="overlay-checkbox" id="ai-overlay-check" />
      <label class="overlay-checkbox-label" for="ai-overlay-check">${escapeHtml(config.checkboxLabel)}</label>
    </div>
  `
      : "";

  card.innerHTML = `
    <div class="overlay-title">
      <div class="overlay-icon">&#9888;</div>
      <div class="overlay-title-text">${escapeHtml(config.title)}</div>
    </div>
    <div class="overlay-message">${escapeHtml(config.message)}</div>
    ${checkboxHtml}
    <div class="overlay-actions">
      <button class="overlay-btn overlay-btn-secondary" id="ai-overlay-skip">${escapeHtml(config.secondaryLabel ?? "Skip")}</button>
      <button class="overlay-btn overlay-btn-primary" id="ai-overlay-continue" ${config.showCheckbox ? "disabled" : ""}>${escapeHtml(config.primaryLabel ?? "Continue")}</button>
    </div>
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "overlay-backdrop";

  shadow.appendChild(styles);
  shadow.appendChild(backdrop);
  shadow.appendChild(card);

  if (targetElement) {
    targetElement.classList.add("field-highlight");
    targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const checkbox = shadow.getElementById("ai-overlay-check") as HTMLInputElement | null;
  const continueBtn = shadow.getElementById("ai-overlay-continue") as HTMLButtonElement;
  const skipBtn = shadow.getElementById("ai-overlay-skip") as HTMLButtonElement;

  if (checkbox && config.showCheckbox) {
    checkbox.addEventListener("change", () => {
      continueBtn.disabled = !checkbox.checked;
    });
  }

  continueBtn.addEventListener("click", () => {
    if (config.showCheckbox && checkbox && !checkbox.checked) return;
    removeOverlay();
    if (targetElement) targetElement.classList.remove("field-highlight");
    onContinue();
  });

  skipBtn.addEventListener("click", () => {
    removeOverlay();
    if (targetElement) targetElement.classList.remove("field-highlight");
    onSkip?.();
  });
}

function removeOverlay(): void {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
  }
  document.querySelectorAll(".field-highlight").forEach((el) => el.classList.remove("field-highlight"));
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

function sendProgress(progress: AutofillProgress): void {
  chrome.runtime.sendMessage({
    type: MSG.AUTOFILL_PROGRESS,
    data: { ...progress },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function performUndoAll(): void {
  for (const entry of undoSnapshot) {
    let el: HTMLElement | null = null;
    if (document.contains(entry.element)) {
      el = entry.element;
    } else {
      try {
        el = document.querySelector(entry.selector);
      } catch {
        continue;
      }
    }
    if (!el) continue;

    if (entry.isCustomSelect) {
      // Custom dropdowns: cannot easily restore; skip
      continue;
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      applyToField(el, entry.previousValue);
    }
  }
  undoSnapshot = [];
}

function getEffectiveActions(formModel: FormModel): {
  nextAction: FormAction | null;
  submitAction: FormAction | null;
} {
  const adapter = detectPlatform();
  let nextAction = formModel.actions.find((a) => a.type === "next") ?? null;
  let submitAction = formModel.actions.find((a) => a.type === "submit") ?? null;

  if (adapter) {
    const nextSel = adapter.getNextSelector();
    if (nextSel) {
      const el = document.querySelector(nextSel);
      if (el) {
        const sel = (el as HTMLElement).id
          ? `#${CSS.escape((el as HTMLElement).id)}`
          : nextSel;
        nextAction = { type: "next", selector: sel, label: "Next" };
      }
    }
    const submitSel = adapter.getSubmitSelector();
    if (submitSel) {
      const el = document.querySelector(submitSel);
      if (el) {
        const sel = (el as HTMLElement).id
          ? `#${CSS.escape((el as HTMLElement).id)}`
          : submitSel;
        submitAction = { type: "submit", selector: sel, label: "Submit" };
      }
    }
  }

  return { nextAction, submitAction };
}

// ---------------------------------------------------------------------------
// State machine: main loop
// ---------------------------------------------------------------------------

async function runAutofill(profile: UserProfile): Promise<void> {
  stopped = false;
  const loopStartTime = Date.now();
  const navCount = { value: 0 };

  const stopPassiveMonitor = startPassiveFormMonitor(() => {
    // Rescan will happen at next loop iteration
  });
  const unpatchHistory = patchHistoryAPI(() => {
    // Route change - rescan will happen at next loop iteration
  });
  try {
    await runAutofillLoop(profile, loopStartTime, navCount);
  } finally {
    stopPassiveMonitor();
    unpatchHistory();
  }
}

async function runAutofillLoop(
  profile: UserProfile,
  loopStartTime: number,
  navCount: { value: number }
): Promise<void> {
  const createProgress = (overrides: Partial<AutofillProgress> = {}): AutofillProgress => ({
    state: "intake",
    total: 0,
    filled: 0,
    manual: 0,
    skipped: 0,
    currentField: null,
    currentAction: null,
    paused: false,
    completed: false,
    stepIndex: 0,
    fields: [],
    activeBlocker: null,
    validationErrors: [],
    lastFilledField: null,
    ...overrides,
  });

  let progress = createProgress();
  sendProgress(progress);

  // Main loop: intake → match → (blockers) → apply → validate → navigate
  while (!stopped) {
    if (Date.now() - loopStartTime >= MAX_LOOP_TIME_MS) {
      progress.state = "blocked";
      progress.paused = true;
      sendProgress(progress);
      await new Promise<void>((resolve) => {
        showOverlay(
          null,
          {
            title: "Autofill Timeout",
            message:
              "Autofill has been running for 5 minutes. Continue manually or restart.",
            showCheckbox: false,
            primaryLabel: "OK",
            secondaryLabel: "OK",
            onPrimary: resolve,
          },
          resolve
        );
      });
      removeOverlay();
      progress.state = "stopped";
      progress.completed = true;
      sendProgress(progress);
      return;
    }

    // State A: Page Intake
    progress.state = "intake";
    progress.currentField = null;
    progress.currentAction = null;
    sendProgress(progress);

    const formModel: FormModel = buildFormModel();
    const fillableFields = formModel.fields.filter(
      (f) => !f.filled && !f.fieldType.includes("upload") && f.enabled
    );

    // State B: Field → Profile Matching
    progress.state = "matching";
    const matchedFields = await matchFieldsToProfile(formModel.fields, profile);

    progress.fields = matchedFields;
    progress.total = fillableFields.length;
    sendProgress(progress);

    // State F: Blockers — check unresolved blockers first
    const unresolvedBlockers = formModel.blockers.filter((b) => !b.resolved);

    if (unresolvedBlockers.length > 0) {
      const blocker = unresolvedBlockers[0];
      progress.state = "blocked";
      progress.paused = true;
      progress.activeBlocker = blocker;
      sendProgress(progress);

      const blockerConfig = getBlockerOverlayConfig(blocker);
      await new Promise<void>((resolve) => {
        showOverlay(
          document.querySelector(blocker.selector) ?? null,
          blockerConfig,
          () => resolve(),
          () => resolve()
        );
      });

      progress.paused = false;
      progress.activeBlocker = null;
      sendProgress(progress);
      removeOverlay();
      continue;
    }

    // No fillable fields — try navigation or complete
    if (fillableFields.length === 0) {
      const { nextAction, submitAction } = getEffectiveActions(formModel);

      if (nextAction && !stopped) {
        if (navCount.value >= MAX_NAVIGATION_CLICKS) {
          progress.state = "blocked";
          progress.paused = true;
          sendProgress(progress);
          await new Promise<void>((resolve) => {
            showOverlay(
              null,
              {
                title: "Step Limit Reached",
                message:
                  "Autofill has completed 20 steps. Continue manually or restart.",
                showCheckbox: false,
                primaryLabel: "OK",
                secondaryLabel: "OK",
                onPrimary: resolve,
              },
              resolve
            );
          });
          removeOverlay();
          progress.state = "stopped";
          progress.completed = true;
          sendProgress(progress);
          return;
        }
        progress.state = "navigate";
        progress.currentAction = nextAction.label;
        sendProgress(progress);

        const btn = document.querySelector(nextAction.selector);
        if (btn && btn instanceof HTMLElement) {
          const prevFingerprint = computeStepFingerprint(formModel);
          btn.click();
          navCount.value++;
          const result = await waitForStepChange(buildFormModel, prevFingerprint, 5000);
          if (result === "new_step") {
            progress.stepIndex++;
            sendProgress(progress);
            continue;
          }
          if (result === "validation_error") {
            const errors = detectValidationErrors();
            progress.state = "validate";
            progress.validationErrors = errors;
            progress.paused = true;
            sendProgress(progress);
            await new Promise<void>((resolve) => {
              showOverlay(
                btn,
                {
                  title: "Validation Error",
                  message: `Server reported errors: ${errors[0] ?? "Please fix and continue."}`,
                  showCheckbox: true,
                  checkboxLabel: "I have corrected the errors",
                  primaryLabel: "Continue",
                  secondaryLabel: "Skip",
                  onPrimary: resolve,
                },
                resolve,
                resolve
              );
            });
            progress.paused = false;
            progress.validationErrors = [];
            sendProgress(progress);
            removeOverlay();
            continue;
          }
          if (result === "stuck") {
            progress.state = "blocked";
            progress.paused = true;
            sendProgress(progress);
            await new Promise<void>((resolve) => {
              showOverlay(
                btn,
                {
                  title: "Stuck",
                  message:
                    "The form did not change after clicking Next. Continue manually or restart.",
                  showCheckbox: false,
                  primaryLabel: "OK",
                  secondaryLabel: "OK",
                  onPrimary: resolve,
                },
                resolve
              );
            });
            removeOverlay();
            progress.state = "stopped";
            progress.completed = true;
            sendProgress(progress);
            return;
          }
        }
      }

      if (submitAction && !stopped) {
        progress.state = "blocked";
        progress.paused = true;
        progress.activeBlocker = {
          type: "submit_confirmation",
          selector: submitAction.selector,
          label: submitAction.label,
          resolved: false,
        };
        sendProgress(progress);

        let didConfirmSubmit = false;
        await new Promise<void>((resolve) => {
          showOverlay(
            document.querySelector(submitAction.selector) ?? null,
            {
              title: "Confirm Submit",
              message:
                "Review your application before submitting. Click Submit to send, or Cancel to abort.",
              showCheckbox: false,
              primaryLabel: "Submit",
              secondaryLabel: "Cancel",
              onPrimary: () => {},
            },
            () => {
              didConfirmSubmit = true;
              resolve();
            },
            () => resolve()
          );
        });

        progress.paused = false;
        progress.activeBlocker = null;
        sendProgress(progress);

        if (didConfirmSubmit) {
          const btn = document.querySelector(submitAction.selector);
          if (btn && btn instanceof HTMLElement) {
            btn.click();
          }
        }
      }

      progress.state = "complete";
      progress.completed = true;
      sendProgress(progress);
      return;
    }

    // State C: Apply — fill fields
    progress.state = "apply";

    undoSnapshot = [];
    for (const field of fillableFields) {
      const mf = matchedFields.find((f) => f.selector === field.selector);
      if (mf?.confidenceTier === "A" && mf?.profileValue) {
        const el = document.querySelector(field.selector);
        if (el) {
          const prev =
            field.fieldKind === "custom_select"
              ? (el as HTMLElement).textContent?.trim() ?? ""
              : (el as HTMLInputElement).value ?? "";
          undoSnapshot.push({
            element: el as HTMLElement,
            selector: field.selector,
            previousValue: prev,
            isCustomSelect: field.fieldKind === "custom_select",
          });
        }
      }
    }

    for (const field of fillableFields) {
      if (stopped) return;

      const matchedField = matchedFields.find((f) => f.selector === field.selector);
      if (!matchedField) continue;

      const el = document.querySelector(progress.fields.find((f) => f.selector === field.selector)?.selector ?? field.selector);

      if (!el) {
        progress.skipped++;
        sendProgress(progress);
        continue;
      }

      progress.currentField = field.label;
      sendProgress(progress);

      const shouldFill = matchedField.confidenceTier === "A" && !!matchedField.profileValue;

      if (shouldFill && matchedField.profileValue) {
        const currentValue =
          field.fieldKind === "custom_select"
            ? ""
            : (el as HTMLInputElement).value ?? "";
        const profileValue = matchedField.profileValue;

        if (!isValueEffectivelyEmpty(String(currentValue).trim())) {
          if (valuesMatch(currentValue, profileValue)) {
            matchedField.filled = true;
            progress.filled++;
            sendProgress(progress);
            await sleep(getInterFieldDelayMs());
            continue;
          }
          progress.paused = true;
          progress.state = "blocked";
          sendProgress(progress);

          const useProfile = await new Promise<boolean>((resolve) => {
            showOverlay(
              el,
              {
                title: "Pre-filled Field",
                message: `This field already has: "${currentValue.slice(0, 50)}${currentValue.length > 50 ? "..." : ""}". Your profile has: "${profileValue.slice(0, 50)}${profileValue.length > 50 ? "..." : ""}". Which do you want?`,
                showCheckbox: false,
                primaryLabel: "Use Profile",
                secondaryLabel: "Keep Existing",
                onPrimary: () => {},
              },
              () => resolve(true),
              () => resolve(false)
            );
          });

          progress.paused = false;
          progress.state = "apply";
          removeOverlay();

          if (!useProfile) {
            progress.skipped++;
            sendProgress(progress);
            await sleep(getInterFieldDelayMs());
            continue;
          }
        }

        let previousValue: string;
        if (field.fieldKind === "custom_select") {
          const trigger = field.triggerSelector
            ? document.querySelector(field.triggerSelector) ?? el
            : el;
          previousValue = await fillCustomDropdown(
            trigger,
            profileValue,
            profile.country ?? null
          );
        } else {
          previousValue = applyToField(
            el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
            profileValue,
            profile.country ?? null
          );
        }
        matchedField.filled = true;
        progress.filled++;
        progress.lastFilledField = { selector: field.selector, label: field.label };
        sendProgress(progress);
        await sleep(getInterFieldDelayMs());

        // State D: Validation
        const errors = detectValidationErrors();
        if (errors.length > 0) {
          progress.state = "validate";
          progress.validationErrors = errors;
          progress.paused = true;
          sendProgress(progress);

          await new Promise<void>((resolve) => {
            showOverlay(
              el,
              {
                title: "Validation Error",
                message: `Validation errors detected: ${errors[0]}. Please correct the field and continue.`,
                showCheckbox: true,
                checkboxLabel: "I have corrected the field",
                primaryLabel: "Continue",
                secondaryLabel: "Undo",
                onPrimary: resolve,
              },
              resolve,
              () => {
                if (
                  el instanceof HTMLInputElement ||
                  el instanceof HTMLTextAreaElement ||
                  el instanceof HTMLSelectElement
                ) {
                  applyToField(el, previousValue);
                }
                matchedField.filled = false;
                progress.filled--;
                progress.lastFilledField = null;
                resolve();
              }
            );
          });

          progress.paused = false;
          progress.validationErrors = [];
          sendProgress(progress);
          removeOverlay();
        }
      } else if (matchedField.confidenceTier === "B" && matchedField.profileValue) {
        // Tier B: suggest value, user confirms Fill or Skip
        progress.paused = true;
        progress.state = "blocked";
        sendProgress(progress);

        const result = await new Promise<"fill" | "skip">((resolve) => {
          showOverlay(
            el,
            {
              title: "Suggestion",
              message: `I think this is ${field.label}. Value: "${(matchedField.profileValue ?? "").slice(0, 60)}${(matchedField.profileValue ?? "").length > 60 ? "..." : ""}"`,
              showCheckbox: false,
              primaryLabel: "Fill",
              secondaryLabel: "Skip",
              onPrimary: () => {},
            },
            () => resolve("fill"),
            () => resolve("skip")
          );
        });

        progress.paused = false;
        progress.state = "apply";
        removeOverlay();

        if (result === "fill") {
          saveLearnedMapping(
            field.selector,
            normalizeLabel(field.label),
            field.fieldType
          ).catch(() => {});
          if (field.fieldKind === "custom_select") {
            const trigger = field.triggerSelector
              ? document.querySelector(field.triggerSelector) ?? el
              : el;
            await fillCustomDropdown(trigger, matchedField.profileValue!, profile.country ?? null);
          } else {
            applyToField(
              el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
              matchedField.profileValue!,
              profile.country ?? null
            );
          }
          matchedField.filled = true;
          progress.filled++;
        } else {
          progress.skipped++;
        }
        sendProgress(progress);
        await sleep(getInterFieldDelayMs());
      } else {
        // Tier C / unknown — pause for manual
        progress.paused = true;
        progress.state = "blocked";
        sendProgress(progress);

        const result = await new Promise<"manual" | "skip">((resolve) => {
          showOverlay(
            el,
            {
              title: "Auto-fill Paused",
              message: `Could not determine value for: ${field.label}`,
              showCheckbox: true,
              checkboxLabel: "I have filled this field manually",
              primaryLabel: "Continue",
              secondaryLabel: "Skip",
              onPrimary: () => {},
            },
            () => resolve("manual"),
            () => resolve("skip")
          );
        });

        progress.paused = false;
        progress.state = "apply";
        removeOverlay();

        if (result === "manual") {
          matchedField.manual = true;
          progress.manual++;
        } else {
          progress.skipped++;
        }
        sendProgress(progress);
      }
    }

    // After filling all fields on this "page", try to click Next
    const { nextAction } = getEffectiveActions(formModel);
    if (nextAction && !stopped) {
      if (navCount.value >= MAX_NAVIGATION_CLICKS) {
        progress.state = "blocked";
        progress.paused = true;
        sendProgress(progress);
        await new Promise<void>((resolve) => {
          showOverlay(
            null,
            {
              title: "Step Limit Reached",
              message:
                "Autofill has completed 20 steps. Continue manually or restart.",
              showCheckbox: false,
              primaryLabel: "OK",
              secondaryLabel: "OK",
              onPrimary: resolve,
            },
            resolve
          );
        });
        removeOverlay();
        progress.state = "stopped";
        progress.completed = true;
        sendProgress(progress);
        return;
      }
      progress.state = "navigate";
      progress.currentAction = nextAction.label;
      sendProgress(progress);

      const btn = document.querySelector(nextAction.selector);
      if (btn && btn instanceof HTMLElement) {
        const prevFingerprint = computeStepFingerprint(formModel);
        btn.click();
        navCount.value++;
        const result = await waitForStepChange(buildFormModel, prevFingerprint, 5000);
        if (result === "new_step") {
          progress.stepIndex++;
          sendProgress(progress);
        } else if (result === "validation_error") {
          const errors = detectValidationErrors();
          progress.state = "validate";
          progress.validationErrors = errors;
          progress.paused = true;
          sendProgress(progress);
          await new Promise<void>((resolve) => {
            showOverlay(
              btn,
              {
                title: "Validation Error",
                message: `Server reported errors: ${errors[0] ?? "Please fix and continue."}`,
                showCheckbox: true,
                checkboxLabel: "I have corrected the errors",
                primaryLabel: "Continue",
                secondaryLabel: "Skip",
                onPrimary: resolve,
              },
              resolve,
              resolve
            );
          });
          progress.paused = false;
          progress.validationErrors = [];
          sendProgress(progress);
          removeOverlay();
        } else if (result === "stuck") {
          progress.state = "blocked";
          progress.paused = true;
          sendProgress(progress);
          await new Promise<void>((resolve) => {
            showOverlay(
              btn,
              {
                title: "Stuck",
                message:
                  "The form did not change after clicking Next. Continue manually or restart.",
                showCheckbox: false,
                primaryLabel: "OK",
                secondaryLabel: "OK",
                onPrimary: resolve,
              },
              resolve
            );
          });
          removeOverlay();
          progress.state = "stopped";
          progress.completed = true;
          sendProgress(progress);
          return;
        }
      }
    }
  }

  progress.state = "stopped";
  progress.completed = true;
  sendProgress(progress);
}

function getBlockerOverlayConfig(blocker: FormBlocker): OverlayConfig {
  switch (blocker.type) {
    case "file_upload":
      return {
        title: "Upload Required",
        message: `${blocker.label} — Please upload the file. Browsers restrict programmatic file selection.`,
        showCheckbox: true,
        checkboxLabel: "I have uploaded the file",
        primaryLabel: "Continue",
        secondaryLabel: "Skip",
        onPrimary: () => {},
      };
    case "captcha":
      return {
        title: "CAPTCHA Required",
        message: "Please complete the CAPTCHA verification. We cannot automate this.",
        showCheckbox: true,
        checkboxLabel: "I have completed the CAPTCHA",
        primaryLabel: "Continue",
        secondaryLabel: "Skip",
        onPrimary: () => {},
      };
    case "otp":
      return {
        title: "Verification Required",
        message: "Please enter the verification code sent to your email or phone.",
        showCheckbox: true,
        checkboxLabel: "I have entered the code",
        primaryLabel: "Continue",
        secondaryLabel: "Skip",
        onPrimary: () => {},
      };
    case "agreement":
      return {
        title: "Agreement Required",
        message: `${blocker.label} — Please check the box to agree.`,
        showCheckbox: true,
        checkboxLabel: "I have checked the agreement",
        primaryLabel: "Continue",
        secondaryLabel: "Skip",
        onPrimary: () => {},
      };
    default:
      return {
        title: "Action Required",
        message: blocker.label,
        showCheckbox: true,
        checkboxLabel: "I have completed this step",
        primaryLabel: "Continue",
        secondaryLabel: "Skip",
        onPrimary: () => {},
      };
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG.START_AUTOFILL) {
    if (window !== window.top) {
      sendResponse({ error: "Auto-fill runs in the main frame only." });
      return false;
    }
    chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE], (result) => {
      const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
      if (!profile) {
        sendResponse({ error: "No user profile found" });
        return;
      }
      runAutofill(profile).then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.type === MSG.STOP_AUTOFILL) {
    stopped = true;
    removeOverlay();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_UNDO_ALL) {
    performUndoAll();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.DETECT_JOB_DESCRIPTION) {
    const selectors = [
      '[data-testid="jobDescription"]',
      ".job-description",
      ".job-details",
      "#job-description",
      "#jobDescriptionText",
      ".description__text",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent && el.textContent.length > 100) {
        sendResponse({ text: el.textContent.trim() });
        return;
      }
    }
    sendResponse({ text: null });
    return;
  }
});
