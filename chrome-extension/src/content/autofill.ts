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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_DELAY_MS = 150;
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

// ---------------------------------------------------------------------------
// DOM value setter (State C: Apply — triggers React/Angular/Vue)
// ---------------------------------------------------------------------------

function setFieldValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const match =
      options.find((o) => o.value.toLowerCase() === value.toLowerCase()) ||
      options.find((o) => o.textContent?.toLowerCase().includes(value.toLowerCase()));
    if (match) {
      el.value = match.value;
    } else {
      el.value = value;
    }
  } else {
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
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

function applyToField(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): string {
  const previous = el.value ?? "";
  el.focus();
  setFieldValue(el, value);
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

// ---------------------------------------------------------------------------
// State machine: main loop
// ---------------------------------------------------------------------------

async function runAutofill(profile: UserProfile): Promise<void> {
  stopped = false;

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
    const matchedFields = matchFieldsToProfile(formModel.fields, profile);

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
      const nextAction = formModel.actions.find((a) => a.type === "next");
      const submitAction = formModel.actions.find((a) => a.type === "submit");

      if (nextAction && !stopped) {
        progress.state = "navigate";
        progress.currentAction = nextAction.label;
        sendProgress(progress);

        const btn = document.querySelector(nextAction.selector);
        if (btn && btn instanceof HTMLElement) {
          btn.click();
          await sleep(500);
          progress.stepIndex++;
          sendProgress(progress);
          continue;
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

    for (const field of fillableFields) {
      if (stopped) return;

      const matchedField = matchedFields.find((f) => f.selector === field.selector);
      if (!matchedField) continue;

      const el = document.querySelector(progress.fields.find((f) => f.selector === field.selector)?.selector ?? field.selector) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;

      if (!el) {
        progress.skipped++;
        sendProgress(progress);
        continue;
      }

      progress.currentField = field.label;
      sendProgress(progress);

      const shouldFill =
        matchedField.confidenceTier === "high" ||
        (matchedField.confidenceTier === "medium" && matchedField.profileValue);

      if (shouldFill && matchedField.profileValue) {
        const previousValue = applyToField(el, matchedField.profileValue);
        matchedField.filled = true;
        progress.filled++;
        progress.lastFilledField = {
          selector: field.selector,
          label: field.label,
          previousValue,
        };
        sendProgress(progress);
        await sleep(FIELD_DELAY_MS);

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
                applyToField(el, previousValue);
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
      } else {
        // Low confidence — pause for manual
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
              onPrimary: () => resolve("manual"),
              onSecondary: () => resolve("skip"),
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
    const nextAction = formModel.actions.find((a) => a.type === "next");
    if (nextAction && !stopped) {
      progress.state = "navigate";
      progress.currentAction = nextAction.label;
      sendProgress(progress);

      const btn = document.querySelector(nextAction.selector);
      if (btn && btn instanceof HTMLElement) {
        btn.click();
        await sleep(500);
        progress.stepIndex++;
        sendProgress(progress);
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
