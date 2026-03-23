/**
 * Content script: State-machine autofill for job application forms.
 *
 * State A: Page Intake ? Build form model (fields, actions, blockers)
 * State B: Field ? Profile Matching ? Confidence-driven mapping
 * State C: Apply ? Fill inputs (focus, set value, events)
 * State D: Validation ? Check for inline errors
 * State E: Navigation ? Click Next/Continue, loop
 * State F: Blockers ? Pause for upload/CAPTCHA/OTP/agreement/submit
 */

import { API_BASE_URL, MSG, STORAGE_KEYS } from "@/shared/constants";
import { runPhase1Fill } from "@/shared/dom-control-engine";
import type {
  UserProfile,
  AutofillProgress,
  AutofillSession,
  ValidationErrorItem,
  FormModel,
  FormField,
  FormBlocker,
  FormAction,
  FileUploadBlockerDecision,
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
  NJ: ["New Jersey"],
  "New Jersey": ["NJ"],
  IL: ["Illinois"],
  Illinois: ["IL"],
  VA: ["Virginia"],
  Virginia: ["VA"],
  WA: ["Washington"],
  Washington: ["WA"],
  NC: ["North Carolina"],
  "North Carolina": ["NC"],
  SC: ["South Carolina"],
  "South Carolina": ["SC"],
  DC: ["District of Columbia", "Washington DC", "Washington D.C."],
  "District of Columbia": ["DC", "Washington DC", "Washington D.C."],
};

const US_STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
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

function valuesExactlyMatch(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

const FORMAT_PREFERENCE_FIELD_TYPES = new Set([
  "first_name",
  "last_name",
  "full_name",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "country",
  "current_title",
  "current_company",
]);

function shouldRewriteForFormatting(
  currentValue: string,
  profileValue: string,
  fieldType: string,
  fieldKind: FormField["fieldKind"] | undefined,
  el: Element
): boolean {
  if (!valuesMatch(currentValue, profileValue)) return false;
  if (valuesExactlyMatch(currentValue, profileValue)) return false;
  if (fieldKind === "custom_select") return false;
  if (el instanceof HTMLSelectElement) return false;
  return FORMAT_PREFERENCE_FIELD_TYPES.has(fieldType);
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
    const upper = value.trim().toUpperCase();
    const expanded = [
      ...(SELECT_ABBREVIATIONS[value.trim()] ?? []),
      ...(SELECT_ABBREVIATIONS[upper] ?? []),
      ...(US_STATE_ABBR_TO_NAME[upper] ? [US_STATE_ABBR_TO_NAME[upper]] : []),
    ];
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

/** Phase 2: 0 for single-page fill. Phase 3+: multi-step navigation (never auto-click Submit). */
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
let resolvePreviewPromise: (() => void) | null = null;
let resolveUploadBlockerDecision: ((decision: FileUploadBlockerDecision) => void) | null = null;
let iframeObserverInitialized = false;
let autofillRunInProgress = false;
let sessionWatcherStarted = false;
let sessionWatcherCleanup: (() => void) | null = null;
let requestSessionWatcherActivation: ((runInitialPass: boolean) => void) | null = null;
const handledUploadBlockers = new Map<string, FileUploadBlockerDecision>();

type SessionAutofillRelayResponse = {
  success?: boolean;
  total?: number;
  filled?: number;
  skipped?: number;
  newFilledKeys?: string[];
  error?: string;
};

interface AutofillRunOptions {
  suppressWorkAndSkills: boolean;
  isSessionContinuation?: boolean;
  sessionFilledFieldTypes?: Set<string>;
}

const DEFAULT_AUTOFILL_OPTIONS: AutofillRunOptions = {
  suppressWorkAndSkills: false,
  isSessionContinuation: false,
  sessionFilledFieldTypes: new Set(),
};

const SUPPRESSED_WORK_SKILL_FIELD_TYPES = new Set([
  "years_of_experience",
  "current_title",
  "current_company",
]);

const SUPPRESSED_WORK_SKILL_PATTERNS = [
  /\bskills?\b/i,
  /\btechnical\s+skills?\b/i,
  /\btechnologies?\b/i,
  /\bwork\s+experience\b/i,
  /\bemployment\s+history\b/i,
];

interface UndoEntry {
  element: HTMLElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  selector: string;
  previousValue: string;
  isCustomSelect: boolean;
}
let undoSnapshot: UndoEntry[] = [];

type DiagnosticStatus = "PASS" | "FAIL";

interface DiagnosticStepResult {
  step: string;
  gist: string;
  status: DiagnosticStatus;
  detail?: string;
}

interface AutofillDiagnosticsResponse {
  ok: boolean;
  steps: DiagnosticStepResult[];
}

function emitDiagTrace(
  step: string,
  detail: string,
  level: "info" | "warn" | "error" = "info"
): void {
  const traceData = {
    source: "content",
    step,
    detail,
    level,
    ts: Date.now(),
    isTopFrame: window === window.top,
    href: window.location.href,
  };
  const payload = {
    type: MSG.AUTOFILL_DIAG_TRACE,
    data: traceData,
  };
  chrome.storage.local
    .get([STORAGE_KEYS.AUTOFILL_TRACE_LOG])
    .then((result) => {
      const prev = Array.isArray(result[STORAGE_KEYS.AUTOFILL_TRACE_LOG])
        ? (result[STORAGE_KEYS.AUTOFILL_TRACE_LOG] as Array<Record<string, unknown>>)
        : [];
      const next = [traceData, ...prev].slice(0, 100);
      return chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_TRACE_LOG]: next });
    })
    .catch(() => {});
  chrome.runtime.sendMessage(payload).catch(() => {});
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`AUTOFILL TRACE [content] ${step}: ${detail}`);
}

// ---------------------------------------------------------------------------
// DOM value setter (State C: Apply ? triggers React/Angular/Vue)
// ---------------------------------------------------------------------------

function setFieldValueSync(
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

/** Single robust value setter: native setter + events, then re-read after 100ms; if value didn't stick, use execCommand('insertText'). */
async function setFieldValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  countryContext?: string | null
): Promise<void> {
  if (el instanceof HTMLSelectElement) {
    setFieldValueSync(el, value, countryContext);
    return;
  }

  setFieldValueSync(el, value, countryContext);
  await sleep(100);
  const current = (el as HTMLInputElement | HTMLTextAreaElement).value ?? "";
  if (current.trim() === value.trim()) return;

  el.focus();
  el.select();
  try {
    document.execCommand("insertText", false, value);
  } catch {
    setFieldValueSync(el, value, countryContext);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

async function applyToField(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  countryContext?: string | null
): Promise<string> {
  const previous = el.value ?? "";
  el.focus();
  await setFieldValue(el, value, countryContext);
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
// File upload ? programmatic fill when resume/cover letter URL is available
// ---------------------------------------------------------------------------

async function tryFillFileBlocker(blocker: FormBlocker): Promise<boolean> {
  if (blocker.type !== "file_upload" || (blocker.subType !== "resume" && blocker.subType !== "cover_letter"))
    return false;
  const el = document.querySelector(blocker.selector) as HTMLInputElement | null;
  if (!el || el.type !== "file") return false;

  const stored = await new Promise<Record<string, string>>((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.RESUME_FILE_URL], (r) => resolve(r as Record<string, string>));
  });
  const fileUrl = stored[STORAGE_KEYS.RESUME_FILE_URL];
  if (!fileUrl) return false;

  try {
    const resp = await fetch(fileUrl, { credentials: "omit" });
    if (!resp.ok) return false;
    const blob = await resp.blob();
    const filename = fileUrl.split("/").pop()?.split("?")[0] || "resume.docx";
    const file = new File([blob], filename, { type: blob.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// State D: Validation ? detect inline errors
// ---------------------------------------------------------------------------

function stableSelectorForElement(el: Element): string {
  if ((el as HTMLElement).id) return `#${CSS.escape((el as HTMLElement).id)}`;
  const name = el.getAttribute?.("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  return el.tagName.toLowerCase();
}

function detectValidationErrors(): ValidationErrorItem[] {
  const errors: ValidationErrorItem[] = [];
  const seen = new Set<string>();

  function addError(msg: string, field?: { selector: string; label: string; value?: string }) {
    const key = `${msg}:${field?.selector ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({
      message: msg,
      fieldSelector: field?.selector,
      fieldLabel: field?.label,
      value: field?.value,
    });
  }

  for (const sel of VALIDATION_ERROR_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      const text = el.textContent?.trim();
      if (!text || text.length >= 200) return;

      let fieldEl: Element | null = null;
      let value: string | undefined;

      if (el.getAttribute?.("aria-invalid") === "true") {
        fieldEl = el;
        value = (el as HTMLInputElement).value ?? (el as HTMLElement).textContent ?? undefined;
      } else {
        const form = el.closest("form");
        if (form) {
          const prev = el.previousElementSibling;
          if (prev && (prev.matches?.("input, select, textarea") || (prev as HTMLElement).getAttribute?.("for"))) {
            const forId = (prev as HTMLElement).getAttribute?.("for");
            fieldEl = forId ? form.querySelector(`#${CSS.escape(forId)}`) : prev;
            if (fieldEl && "value" in fieldEl) value = (fieldEl as HTMLInputElement).value;
          }
          if (!fieldEl) {
            const input = el.closest("label")?.control ?? el.previousElementSibling ?? el.parentElement?.querySelector?.("input, select, textarea");
            fieldEl = input ?? null;
            if (fieldEl && "value" in fieldEl) value = (fieldEl as HTMLInputElement).value;
          }
        }
      }

      const selector = fieldEl ? stableSelectorForElement(fieldEl) : undefined;
      const label = fieldEl ? (fieldEl.getAttribute?.("aria-label") ?? ((fieldEl as HTMLElement).id ? document.querySelector(`label[for="${(fieldEl as HTMLElement).id}"]`)?.textContent?.trim() : null) ?? "") : undefined;
      addError(text, selector ? { selector, label: label ?? selector, value } : undefined);
    });
  }
  return errors;
}

function highlightValidationFields(errors: ValidationErrorItem[]): void {
  errors.forEach((err) => {
    if (err.fieldSelector) {
      try {
        document.querySelector(err.fieldSelector)?.classList.add("field-highlight");
      } catch {
        // ignore invalid selector
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Overlay (Shadow DOM) ? pause, blocker, field manual
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

let undoButtonHost: HTMLDivElement | null = null;

function showUndoButton(): void {
  if (undoButtonHost || undoSnapshot.length === 0) return;
  undoButtonHost = document.createElement("div");
  undoButtonHost.id = "ai-assistant-undo-host";
  document.body.appendChild(undoButtonHost);
  const shadow = undoButtonHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .undo-pill { position: fixed; bottom: 16px; right: 16px; z-index: 2147483645;
        padding: 8px 14px; border-radius: 20px; background: #F97316; color: white;
        font-size: 12px; font-weight: 500; cursor: pointer; border: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
      .undo-pill:hover { background: #EA580C; }
    </style>
    <button type="button" class="undo-pill">Undo All</button>
  `;
  shadow.querySelector("button")!.addEventListener("click", () => {
    performUndoAll().then(() => {
      removeUndoButton();
    });
  });
}

function removeUndoButton(): void {
  if (undoButtonHost) {
    undoButtonHost.remove();
    undoButtonHost = null;
  }
}

// ---------------------------------------------------------------------------
// Session badge ? persistent floating indicator for multi-page sessions
// ---------------------------------------------------------------------------

let sessionBadgeHost: HTMLDivElement | null = null;

function showSessionBadge(): void {
  if (sessionBadgeHost) return;
  sessionBadgeHost = document.createElement("div");
  sessionBadgeHost.id = "ai-assistant-session-badge";
  document.body.appendChild(sessionBadgeHost);
  const shadow = sessionBadgeHost.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .session-badge {
      position: fixed; top: 12px; right: 12px; z-index: 2147483645;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 24px;
      background: linear-gradient(135deg, #F97316, #EA580C);
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px; font-weight: 500;
      box-shadow: 0 4px 12px rgba(249,115,22,0.35);
      cursor: default; user-select: none;
      animation: badge-in 0.3s ease-out;
    }
    @keyframes badge-in {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #4ADE80;
      animation: dot-pulse 1.5s ease-in-out infinite;
    }
    @keyframes dot-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.8); }
    }
    .cancel-btn {
      display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border: none;
      background: rgba(255,255,255,0.25); color: white;
      border-radius: 50%; cursor: pointer; font-size: 12px;
      line-height: 1; padding: 0; transition: background 0.15s;
    }
    .cancel-btn:hover { background: rgba(255,255,255,0.45); }
  `;

  const badge = document.createElement("div");
  badge.className = "session-badge";
  badge.innerHTML = `
    <div class="pulse-dot"></div>
    <span>Auto-fill active</span>
    <button class="cancel-btn" title="Cancel auto-fill session">\u2715</button>
  `;

  shadow.appendChild(style);
  shadow.appendChild(badge);

  badge.querySelector(".cancel-btn")!.addEventListener("click", () => {
    chrome.runtime
      .sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "user_badge" } })
      .catch(() => {});
    removeSessionBadge();
    stopped = true;
  });
}

function removeSessionBadge(): void {
  if (sessionBadgeHost) {
    sessionBadgeHost.remove();
    sessionBadgeHost = null;
  }
}

// ---------------------------------------------------------------------------
// Success page detection ? terminates multi-page session
// ---------------------------------------------------------------------------

const SUCCESS_DOM_PATTERNS = [
  /application\s+(?:has\s+been\s+)?submitted/i,
  /thank\s+you\s+for\s+(?:applying|your\s+application)/i,
  /we\s+(?:have\s+)?received\s+your\s+application/i,
  /application\s+(?:is\s+)?complete/i,
  /successfully\s+submitted/i,
  /you(?:'ve|\s+have)\s+applied/i,
];

const SUCCESS_URL_PATTERNS = [
  /[/](?:success|thank[\s_-]?you|confirmation|submitted|application[\s_-]?received|completed?)(?:[/?#]|$)/i,
];

function isSuccessPage(): boolean {
  if (SUCCESS_URL_PATTERNS.some((p) => p.test(location.href))) return true;
  const headings = Array.from(
    document.querySelectorAll('h1, h2, h3, [role="heading"]')
  )
    .map((el) => el.textContent?.trim() ?? "")
    .join(" ");
  const bodySnippet = document.body?.innerText?.slice(0, 2000) ?? "";
  const combined = `${headings} ${bodySnippet}`;
  return SUCCESS_DOM_PATTERNS.some((p) => p.test(combined));
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
  const payload: AutofillProgress = {
    ...progress,
    sessionComplete: progress.sessionComplete ?? false,
  };
  chrome.storage.local
    .set({
      [STORAGE_KEYS.AUTOFILL_PROGRESS]: {
        ...payload,
        _ts: Date.now(),
      },
    })
    .catch(() => {});
  chrome.runtime
    .sendMessage({
      type: MSG.AUTOFILL_PROGRESS,
      data: payload,
    })
    .catch((err) => {
      // Keep this loud in console so "stuck at Filling..." has a concrete cause.
      console.error("AUTOFILL: failed to send progress message", {
        state: payload.state,
        currentField: payload.currentField,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

function initIframeReloadObserver(): void {
  if (iframeObserverInitialized || window !== window.top) return;
  iframeObserverInitialized = true;

  const attachLoadListener = (iframe: HTMLIFrameElement): void => {
    if ((iframe as HTMLIFrameElement & { __autofillLoadListener?: boolean }).__autofillLoadListener) return;
    (iframe as HTMLIFrameElement & { __autofillLoadListener?: boolean }).__autofillLoadListener = true;
    iframe.addEventListener("load", () => {
      chrome.runtime.sendMessage({
        type: MSG.IFRAME_RELOADED,
        data: {
          pageHref: window.location.href,
          iframeSrc: iframe.src || "(empty-src)",
        },
      }).catch(() => {});
    });
  };

  document.querySelectorAll("iframe").forEach((node) => attachLoadListener(node as HTMLIFrameElement));
  const observer = new MutationObserver(() => {
    document.querySelectorAll("iframe").forEach((node) => attachLoadListener(node as HTMLIFrameElement));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function hasVisibleResumeFileFieldOnPage(): boolean {
  const resumePattern = /\b(resume|cv|upload)\b/i;
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, [role='heading']"));
  const isVisible = (el: HTMLElement): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const nearestHeadingText = (el: HTMLElement): string => {
    const elRect = el.getBoundingClientRect();
    let bestText = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const heading of headings) {
      if (!(heading instanceof HTMLElement)) continue;
      const rect = heading.getBoundingClientRect();
      if (rect.bottom > elRect.top) continue;
      const distance = Math.abs(elRect.top - rect.bottom);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestText = heading.textContent?.trim() ?? "";
      }
    }
    return bestText;
  };
  const getLabelText = (input: HTMLInputElement): string => {
    const labels = input.labels ? Array.from(input.labels) : [];
    const explicit = labels.map((label) => label.textContent?.trim() ?? "").join(" ");
    if (explicit) return explicit;
    const aria = input.getAttribute("aria-label") ?? "";
    if (aria) return aria;
    if (input.id) {
      const fallback = document.querySelector(`label[for=\"${CSS.escape(input.id)}\"]`);
      if (fallback) return fallback.textContent?.trim() ?? "";
    }
    return "";
  };

  const inputs = Array.from(document.querySelectorAll("input[type='file']"))
    .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
    .filter((input) => !input.disabled)
    .filter((input) => isVisible(input));

  return inputs.some((input) => {
    const signal = [
      getLabelText(input),
      input.getAttribute("aria-label") ?? "",
      input.name ?? "",
      input.id ?? "",
      nearestHeadingText(input),
    ]
      .join(" ")
      .toLowerCase();
    return resumePattern.test(signal);
  });
}

async function isResumeAlreadyUploadedInSession(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CHECK });
    const session = (response as { session?: AutofillSession })?.session;
    return Boolean(session?.active && session.resumeFileUploaded === true);
  } catch {
    return false;
  }
}

function markResumeUploadedInSession(): void {
  chrome.runtime
    .sendMessage({
      type: MSG.AUTOFILL_SESSION_UPDATE,
      data: { resumeFileUploaded: true },
    })
    .catch(() => {});
}

function shouldSuppressWorkAndSkillsField(field: FormField): boolean {
  if (SUPPRESSED_WORK_SKILL_FIELD_TYPES.has(field.fieldType)) {
    return true;
  }

  const combinedSignals = [
    field.label,
    field.section ?? "",
    ...field.signals,
    ...(field.signalsWithSource ?? []).map((s) => s.value),
  ]
    .join(" ")
    .trim();

  return SUPPRESSED_WORK_SKILL_PATTERNS.some((pattern) => pattern.test(combinedSignals));
}

function applyMatchedFieldSuppressions(
  matchedFields: FormField[],
  options: AutofillRunOptions
): FormField[] {
  if (!options.suppressWorkAndSkills) {
    return matchedFields;
  }

  return matchedFields.map((field) => {
    if (!shouldSuppressWorkAndSkillsField(field)) {
      return field;
    }

    return {
      ...field,
      profileValue: null,
      confidence: 0,
      confidenceTier: "C",
      matchReason: "suppressed:work_and_skills",
    };
  });
}

function getUploadBlockerKey(blocker: FormBlocker): string {
  return `${blocker.selector}::${blocker.subType ?? "generic"}`;
}

function isHandledUploadBlocker(blocker: FormBlocker): boolean {
  if (blocker.type !== "file_upload") return false;
  return handledUploadBlockers.has(getUploadBlockerKey(blocker));
}

async function performUndoAll(): Promise<void> {
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
      continue;
    }
    if (el.getAttribute?.("contenteditable") === "true") {
      (el as HTMLElement).textContent = entry.previousValue;
      (el as HTMLElement).dispatchEvent(new Event("input", { bubbles: true }));
      continue;
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      await applyToField(el, entry.previousValue);
    }
  }
  undoSnapshot = [];
  removeUndoButton();
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

async function runAutofill(
  profile: UserProfile,
  options: AutofillRunOptions = DEFAULT_AUTOFILL_OPTIONS
): Promise<string[]> {
  stopped = false;
  handledUploadBlockers.clear();
  resolveUploadBlockerDecision = null;
  const loopStartTime = Date.now();
  const navCount = { value: 0 };

  const stopPassiveMonitor = startPassiveFormMonitor(() => {
    // Rescan will happen at next loop iteration
  });
  const unpatchHistory = patchHistoryAPI(() => {
    // Route change - rescan will happen at next loop iteration
  });
  try {
    return await runAutofillLoop(profile, loopStartTime, navCount, options);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    sendProgress({
      state: "blocked",
      total: 0,
      filled: 0,
      manual: 0,
      skipped: 0,
      currentField: null,
      currentAction: "runtime_error",
      paused: true,
      completed: false,
      sessionComplete: false,
      stepIndex: 0,
      fields: [],
      activeBlocker: null,
      validationErrors: [{ message: `Runtime error: ${errorMessage}` }],
      lastFilledField: null,
    });
    throw err;
  } finally {
    stopPassiveMonitor();
    unpatchHistory();
  }
}

async function runAutofillLoop(
  profile: UserProfile,
  loopStartTime: number,
  navCount: { value: number },
  options: AutofillRunOptions
): Promise<string[]> {
  const filledFieldTypesThisRun: string[] = [];
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
    sessionComplete: false,
    stepIndex: 0,
    fields: [],
    activeBlocker: null,
    validationErrors: [],
    lastFilledField: null,
    ...overrides,
  });

  let progress = createProgress();
  sendProgress(progress);

  // Main loop: intake ? match ? (blockers) ? apply ? validate ? navigate
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
      return filledFieldTypesThisRun;
    }

    // State A: Page Intake
    progress.state = "intake";
    progress.currentField = null;
    progress.currentAction = null;
    sendProgress(progress);

    let formModel: FormModel = buildFormModel();

    if (options.isSessionContinuation && formModel.fields.length === 0) {
      for (let retry = 0; retry < 5; retry++) {
        await sleep(500);
        formModel = buildFormModel();
        if (formModel.fields.length > 0) break;
      }
    }

    const fillableCandidates = formModel.fields.filter(
      (f) => !f.filled && !f.fieldType.includes("upload") && f.enabled
    );

    // State F: Blockers ? check unresolved blockers before preview/fill.
    const unresolvedBlockers = formModel.blockers.filter((b) => !b.resolved && !isHandledUploadBlocker(b));

    if (unresolvedBlockers.length > 0) {
      const blocker = unresolvedBlockers[0];

      if (blocker.type === "file_upload" && blocker.subType === "resume") {
        if (!hasVisibleResumeFileFieldOnPage()) {
          handledUploadBlockers.set(getUploadBlockerKey(blocker), "skipped_by_user");
          emitDiagTrace("UploadBlocker", "skip_reason=no_resume_field_on_page");
          continue;
        }
        if (await isResumeAlreadyUploadedInSession()) {
          handledUploadBlockers.set(getUploadBlockerKey(blocker), "resolved_by_user");
          emitDiagTrace("UploadBlocker", "skip_reason=already_uploaded_this_session");
          continue;
        }
      }

      const filled = await tryFillFileBlocker(blocker);
      if (filled) {
        if (blocker.type === "file_upload" && blocker.subType === "resume") {
          markResumeUploadedInSession();
        }
        continue;
      }

      if (blocker.type === "file_upload") {
        progress.state = "blocked";
        progress.paused = true;
        progress.activeBlocker = blocker;
        sendProgress(progress);
        emitDiagTrace("UploadBlocker", `Detected ${blocker.subType ?? "generic"} upload blocker selector=${blocker.selector}`, "warn");

        const decision = await new Promise<FileUploadBlockerDecision>((resolve) => {
          resolveUploadBlockerDecision = resolve;
        });
        resolveUploadBlockerDecision = null;
        handledUploadBlockers.set(getUploadBlockerKey(blocker), decision);
        if (blocker.subType === "resume" && decision === "resolved_by_user") {
          markResumeUploadedInSession();
        }
        emitDiagTrace("UploadBlocker", `Decision ${decision} selector=${blocker.selector}`, "info");
        progress.paused = false;
        progress.activeBlocker = null;
        sendProgress(progress);
        emitDiagTrace("UploadBlocker", `Resuming after ${decision} selector=${blocker.selector}`, "info");
        continue;
      }

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

    // State B: Field ? Profile Matching
    progress.state = "matching";
    const matchedFromProfile = await matchFieldsToProfile(formModel.fields, profile);
    const matchedFields = applyMatchedFieldSuppressions(matchedFromProfile, options);
    let fillableFields = fillableCandidates.filter((field) => {
      const matched = matchedFields.find((mf) => mf.selector === field.selector);
      if (matched?.matchReason === "suppressed:work_and_skills") return false;
      if (options.sessionFilledFieldTypes?.size && matched?.fieldType) {
        if (options.sessionFilledFieldTypes.has(matched.fieldType)) return false;
      }
      return true;
    });

    progress.fields = matchedFields;
    progress.total = fillableFields.length;
    sendProgress(progress);

    // Pre-fill preview: show summary and wait for "Fill All" (skip in session continuation)
    if (options.isSessionContinuation) {
      emitDiagTrace("SessionContinue", "Skipping preview, auto-filling Tier A fields");
    } else {
      const willFill = fillableFields
        .map((f) => {
          const m = matchedFields.find((mf) => mf.selector === f.selector);
          return m?.confidenceTier === "A" || m?.confidenceTier === "B" ? f.label : null;
        })
        .filter(Boolean) as string[];
      const unknownCount = fillableFields.length - willFill.length;
      progress.state = "preview";
      progress.paused = true;
      progress.previewSummary = { total: fillableFields.length, willFill, unknownCount };
      sendProgress(progress);
      await new Promise<void>((resolve) => {
        resolvePreviewPromise = resolve;
      });
      resolvePreviewPromise = null;
    }
    progress.paused = false;
    progress.state = "apply";
    progress.previewSummary = undefined;
    sendProgress(progress);

    progress.currentAction = "Phase 1 basic profile fill";
    sendProgress(progress);

    const phase1Run = runPhase1Fill(profile, document);
    const phase1HandledSelectors = new Set<string>();
    for (const result of phase1Run.results) {
      phase1HandledSelectors.add(result.selector);
      emitDiagTrace(
        "Phase1Fill",
        `${result.action} selector=${result.selector} key=${result.canonicalKey ?? "none"} reason=${result.reason}`,
        result.action === "failed_write" || result.action === "failed_verify" ? "warn" : "info"
      );
      const matchedField = matchedFields.find((field) => field.selector === result.selector);
      if (matchedField && result.action === "filled") {
        matchedField.filled = true;
      }
      if (result.action === "filled") {
        progress.filled++;
        progress.lastFilledField = { selector: result.selector, label: result.label };
        try {
          const el = document.querySelector(result.selector);
          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
          ) {
            undoSnapshot.push({
              element: el,
              selector: result.selector,
              previousValue: result.before,
              isCustomSelect: false,
            });
          }
        } catch {
          // ignore selector lookup failures for undo capture
        }
      }
    }
    fillableFields = fillableFields.filter((field) => !phase1HandledSelectors.has(field.selector));
    progress.currentAction = null;
    sendProgress(progress);

    // No fillable fields ? try navigation or complete
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
          return filledFieldTypesThisRun;
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
            highlightValidationFields(errors);
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
            return filledFieldTypesThisRun;
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
      return filledFieldTypesThisRun;
    }

    // State C: Apply ? fill fields
    progress.state = "apply";

    undoSnapshot = [];
    for (const field of fillableFields) {
      const mf = matchedFields.find((f) => f.selector === field.selector);
      if (mf?.confidenceTier === "A" && mf?.profileValue) {
        const el = document.querySelector(field.selector);
        if (el) {
          const prev =
            field.fieldKind === "custom_select" || field.fieldKind === "contenteditable"
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
      if (stopped) return filledFieldTypesThisRun;

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
            if (
              !shouldRewriteForFormatting(
                currentValue,
                profileValue,
                matchedField.fieldType,
                field.fieldKind,
                el
              )
            ) {
              matchedField.filled = true;
              progress.filled++;
              filledFieldTypesThisRun.push(matchedField.fieldType);
              sendProgress(progress);
              await sleep(getInterFieldDelayMs());
              continue;
            }
          }
          if (options.isSessionContinuation) {
            progress.skipped++;
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
        if (field.fieldKind === "contenteditable") {
          const ce = el as HTMLElement;
          previousValue = ce.textContent?.trim() ?? "";
          ce.focus();
          ce.textContent = profileValue;
          ce.dispatchEvent(new Event("input", { bubbles: true }));
          ce.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (field.fieldKind === "custom_select") {
          const trigger = field.triggerSelector
            ? document.querySelector(field.triggerSelector) ?? el
            : el;
          previousValue = await fillCustomDropdown(
            trigger,
            profileValue,
            profile.country ?? null
          );
        } else {
          previousValue = await applyToField(
            el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
            profileValue,
            profile.country ?? null
          );
        }
        matchedField.filled = true;
        progress.filled++;
        filledFieldTypesThisRun.push(matchedField.fieldType);
        progress.lastFilledField = { selector: field.selector, label: field.label };
        sendProgress(progress);
        showUndoButton();
        await sleep(getInterFieldDelayMs());
        if (field.fieldKind === "custom_select" || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === "radio")) {
          await sleep(500);
          break;
        }

        // State D: Validation
        const errors = detectValidationErrors();
        if (errors.length > 0) {
          progress.state = "validate";
          progress.validationErrors = errors;
          progress.paused = true;
          highlightValidationFields(errors);
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
              async () => {
                if (
                  el instanceof HTMLInputElement ||
                  el instanceof HTMLTextAreaElement ||
                  el instanceof HTMLSelectElement
                ) {
                  await applyToField(el, previousValue);
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
        if (options.isSessionContinuation) {
          progress.skipped++;
          sendProgress(progress);
          continue;
        }
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
            await applyToField(
              el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
              matchedField.profileValue!,
              profile.country ?? null
            );
          }
          matchedField.filled = true;
          progress.filled++;
          filledFieldTypesThisRun.push(matchedField.fieldType);
        } else {
          progress.skipped++;
        }
        sendProgress(progress);
        await sleep(getInterFieldDelayMs());
      } else {
        // Tier C / unknown ? pause for manual
        if (options.isSessionContinuation) {
          progress.skipped++;
          sendProgress(progress);
          continue;
        }
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
        return filledFieldTypesThisRun;
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
          highlightValidationFields(errors);
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
          return filledFieldTypesThisRun;
        }
      }
    }
  }

  progress.state = "stopped";
  progress.completed = true;
  sendProgress(progress);
  return filledFieldTypesThisRun;
}

function getBlockerOverlayConfig(blocker: FormBlocker): OverlayConfig {
  switch (blocker.type) {
    case "file_upload":
      return {
        title: "Upload Required",
        message: `${blocker.label} ? Please upload the file. Browsers restrict programmatic file selection.`,
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
        message: `${blocker.label} ? Please check the box to agree.`,
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

async function runAutofillDiagnostics(): Promise<AutofillDiagnosticsResponse> {
  const steps: DiagnosticStepResult[] = [];
  const startedAt = performance.now();
  emitDiagTrace("DiagnosticsStart", "runAutofillDiagnostics() entered");
  const addStep = (
    step: string,
    gist: string,
    status: DiagnosticStatus,
    detail?: string
  ): void => {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const result: DiagnosticStepResult = { step, gist, status };
    result.detail = detail ? `${detail}; elapsed=${elapsedMs}ms` : `elapsed=${elapsedMs}ms`;
    steps.push(result);
    const prefix = status === "PASS" ? "PASS" : "FAIL";
    const message = `[AUTOFILL DIAG] ${prefix} ${step}: ${gist}${detail ? ` (${detail})` : ""}`;
    if (status === "PASS") {
      console.log(message);
    } else {
      console.error(message);
    }
  };

  // 1) Frame check
  emitDiagTrace("FrameContext", "Checking frame context");
  if (window !== window.top) {
    addStep(
      "FrameContext",
      "Autofill diagnostics must run in top frame",
      "FAIL",
      "Current frame is iframe"
    );
    return { ok: false, steps };
  }
  addStep("FrameContext", "Top frame is active", "PASS");

  // 2) Profile check
  emitDiagTrace("Profile", "Reading profile from chrome.storage.local");
  const profileResult = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
  const profile = profileResult[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
  if (!profile) {
    addStep("Profile", "User profile available in extension storage", "FAIL", "Missing user_profile");
    return { ok: false, steps };
  }
  addStep("Profile", "User profile loaded from extension storage", "PASS");
  emitDiagTrace("Profile", "Profile loaded successfully");

  // 3) Session/auth presence
  emitDiagTrace("Session", "Reading session/auth tokens from storage");
  const storageResult = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.SESSION_ID,
  ]);
  const accessToken = storageResult[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined;
  const sessionId = storageResult[STORAGE_KEYS.SESSION_ID] as string | undefined;
  if (!sessionId) {
    addStep("Session", "Session ID required for backend-scoped requests", "FAIL", "Missing session_id");
  } else {
    addStep("Session", "Session ID found in extension storage", "PASS");
  }
  if (!accessToken) {
    addStep("AuthToken", "Access token needed for authenticated backend routes", "FAIL", "Missing access_token");
  } else {
    addStep("AuthToken", "Access token found in extension storage", "PASS");
  }

  // 4) Backend health
  try {
    emitDiagTrace("BackendHealth", `Calling ${API_BASE_URL}/health`);
    const healthResp = await fetch(`${API_BASE_URL}/health`, { method: "GET" });
    if (healthResp.ok) {
      addStep("BackendHealth", "Backend /health endpoint reachable", "PASS");
      emitDiagTrace("BackendHealth", "Health call succeeded");
    } else {
      addStep(
        "BackendHealth",
        "Backend /health endpoint reachable",
        "FAIL",
        `HTTP ${healthResp.status}`
      );
      emitDiagTrace("BackendHealth", `Health call returned HTTP ${healthResp.status}`, "warn");
    }
  } catch (err) {
    addStep("BackendHealth", "Backend /health endpoint reachable", "FAIL", String(err));
    emitDiagTrace("BackendHealth", `Health call failed: ${String(err)}`, "error");
  }

  // 5) Backend auth check
  if (accessToken) {
    try {
      emitDiagTrace("BackendAuth", `Calling ${API_BASE_URL}/auth/me`);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      if (sessionId) headers["X-Session-Id"] = sessionId;
      const meResp = await fetch(`${API_BASE_URL}/auth/me`, {
        method: "GET",
        headers,
      });
      if (meResp.ok) {
        addStep("BackendAuth", "Backend token validation through /auth/me", "PASS");
        emitDiagTrace("BackendAuth", "Auth check succeeded");
      } else {
        addStep(
          "BackendAuth",
          "Backend token validation through /auth/me",
          "FAIL",
          `HTTP ${meResp.status}`
        );
        emitDiagTrace("BackendAuth", `Auth check returned HTTP ${meResp.status}`, "warn");
      }
    } catch (err) {
      addStep("BackendAuth", "Backend token validation through /auth/me", "FAIL", String(err));
      emitDiagTrace("BackendAuth", `Auth check failed: ${String(err)}`, "error");
    }
  }

  // 6) DOM form intake
  let model: FormModel | null = null;
  try {
    emitDiagTrace("DOMIntake", "buildFormModel() started");
    model = buildFormModel();
    const fieldCount = model.fields.length;
    emitDiagTrace(
      "DOMIntake",
      `buildFormModel() completed fields=${fieldCount} actions=${model.actions.length} blockers=${model.blockers.length}`
    );
    addStep(
      "DOMIntake",
      "Detected form fields/actions/blockers from current page DOM",
      fieldCount > 0 ? "PASS" : "FAIL",
      `fields=${fieldCount}, actions=${model.actions.length}, blockers=${model.blockers.length}`
    );
  } catch (err) {
    addStep("DOMIntake", "Detected form fields/actions/blockers from current page DOM", "FAIL", String(err));
    emitDiagTrace("DOMIntake", `buildFormModel() failed: ${String(err)}`, "error");
  }

  // 7) Field matching
  if (model) {
    try {
      emitDiagTrace("FieldMatching", "matchFieldsToProfile() started");
      const matched = await matchFieldsToProfile(model.fields, profile);
      const confident = matched.filter((f) => f.profileValue && f.confidenceTier !== "C").length;
      emitDiagTrace("FieldMatching", `matchFieldsToProfile() completed matched=${confident} total=${matched.length}`);
      addStep(
        "FieldMatching",
        "Matched DOM fields with profile values",
        confident > 0 ? "PASS" : "FAIL",
        `matched=${confident}, total=${matched.length}`
      );
    } catch (err) {
      addStep("FieldMatching", "Matched DOM fields with profile values", "FAIL", String(err));
      emitDiagTrace("FieldMatching", `matchFieldsToProfile() failed: ${String(err)}`, "error");
    }
  }

  // 8) Autofill readiness summary
  const failedCritical = steps.some(
    (s) =>
      s.status === "FAIL" &&
      ["FrameContext", "Profile", "BackendHealth", "DOMIntake", "FieldMatching"].includes(s.step)
  );
  addStep(
    "Readiness",
    "Overall autofill readiness for current tab",
    failedCritical ? "FAIL" : "PASS",
    failedCritical ? "One or more critical checks failed" : "Ready to start autofill"
  );
  emitDiagTrace("DiagnosticsEnd", `Diagnostics finished ok=${!failedCritical}`);

  return { ok: !failedCritical, steps };
}

// ---------------------------------------------------------------------------
// Message listener (idempotent registration)
// ---------------------------------------------------------------------------

type AutofillWindow = Window & {
  __aiAutofillMessageListenerRegistered?: boolean;
};

function onAutofillMessage(
  message: { type?: string; data?: { suppressWorkAndSkills?: boolean } },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean | void {
  initIframeReloadObserver();
  console.log("AUTOFILL: message received", message?.type);
  if (message.type === MSG.START_AUTOFILL) {
    if (autofillRunInProgress) {
      sendResponse({ success: true, alreadyRunning: true });
      return false;
    }

    // Acknowledge immediately so frame handshake does not wait for full autofill completion.
    sendResponse({ success: true, started: true });
    console.log("AUTOFILL: loading profile", { isTopFrame: window === window.top });
    const runOptions: AutofillRunOptions = {
      suppressWorkAndSkills: !!message.data?.suppressWorkAndSkills,
    };
    emitDiagTrace(
      "StartAutofill",
      `Options suppressWorkAndSkills=${String(runOptions.suppressWorkAndSkills)}`
    );
    emitDiagTrace("StartAutofill", "START_AUTOFILL acknowledged; loading profile and launching run");

    chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE], (result) => {
      const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
      console.log("AUTOFILL: profile", profile ? "present" : "null");
      if (!profile) {
        emitDiagTrace("StartAutofill", "No user profile found in content frame", "error");
        return;
      }

      autofillRunInProgress = true;
      runAutofill(profile, runOptions)
        .then((filledTypes) => {
          if (filledTypes.length > 0) {
            chrome.runtime
              .sendMessage({
                type: MSG.AUTOFILL_SESSION_UPDATE,
                data: { newFilledFieldTypes: filledTypes },
              })
              .catch(() => {});
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("AUTOFILL: runAutofill error", err);
          emitDiagTrace("StartAutofill", `runAutofill failed: ${msg}`, "error");
        })
        .finally(() => {
          autofillRunInProgress = false;
          emitDiagTrace("StartAutofill", "runAutofill finished");
        });
    });
    return false;
  }

  if (message.type === MSG.RUN_AUTOFILL_DIAGNOSTICS) {
    runAutofillDiagnostics()
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          ok: false,
          steps: [
            {
              step: "DiagnosticsRuntime",
              gist: "Unexpected diagnostics runtime error",
              status: "FAIL",
              detail: String(err),
            },
          ],
        })
      );
    return true;
  }

  if (message.type === MSG.AUTOFILL_PING) {
    sendResponse({
      ok: true,
      isTopFrame: window === window.top,
      href: window.location.href,
    });
    return false;
  }

  if (message.type === MSG.STOP_AUTOFILL) {
    stopped = true;
    autofillRunInProgress = false;
    sessionWatcherCleanup?.();
    if (resolveUploadBlockerDecision) {
      resolveUploadBlockerDecision("skipped_by_user");
      resolveUploadBlockerDecision = null;
    }
    removeOverlay();
    removeSessionBadge();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_UNDO_ALL) {
    performUndoAll().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === MSG.AUTOFILL_RESUME) {
    resolvePreviewPromise?.();
    resolvePreviewPromise = null;
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_UPLOAD_BLOCKER_DECISION) {
    const selector = typeof (message as { data?: { selector?: string } }).data?.selector === "string"
      ? (message as { data?: { selector?: string } }).data!.selector!
      : "";
    const decision = (message as { data?: { decision?: FileUploadBlockerDecision } }).data?.decision;
    if (!selector || (decision !== "resolved_by_user" && decision !== "skipped_by_user")) {
      sendResponse({ success: false, error: "Invalid upload blocker decision payload" });
      return false;
    }
    handledUploadBlockers.set(selector.includes("::") ? selector : `${selector}::generic`, decision);
    if (resolveUploadBlockerDecision) {
      resolveUploadBlockerDecision(decision);
      resolveUploadBlockerDecision = null;
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_SESSION_STARTED) {
    showSessionBadge();
    requestSessionWatcherActivation?.(false);
    sendResponse({ success: true });
    return false;
  }

  if (message.type === MSG.AUTOFILL_SESSION_CANCEL) {
    sessionWatcherCleanup?.();
    removeSessionBadge();
    stopped = true;
    autofillRunInProgress = false;
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
}

const autofillWindow = window as AutofillWindow;
if (!autofillWindow.__aiAutofillMessageListenerRegistered) {
  chrome.runtime.onMessage.addListener(onAutofillMessage);
  autofillWindow.__aiAutofillMessageListenerRegistered = true;
  console.log("AUTOFILL: message listener registered");
} else {
  console.log("AUTOFILL: message listener already registered, skipping duplicate registration");
}

// ---------------------------------------------------------------------------
// Multi-page session: persistent watcher + direct relay continuation
// ---------------------------------------------------------------------------

async function getActiveSession(): Promise<AutofillSession | null> {
  try {
    const response: { active?: boolean; session?: AutofillSession } =
      await chrome.runtime.sendMessage({ type: MSG.AUTOFILL_SESSION_CHECK });
    if (!response?.active || !response.session) return null;
    return response.session;
  } catch {
    return null;
  }
}

async function runSessionFillPass(session: AutofillSession): Promise<number> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
  const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
  if (!profile) {
    emitDiagTrace("Session", "No profile found for session continuation", "error");
    return 0;
  }

  sendProgress({
    state: "apply",
    total: 0,
    filled: 0,
    manual: 0,
    skipped: 0,
    currentField: null,
    currentAction: "session_continuation",
    paused: false,
    completed: false,
    sessionComplete: false,
    stepIndex: 0,
    fields: [],
    activeBlocker: null,
    validationErrors: [],
    lastFilledField: null,
  });

  emitDiagTrace("Session", `Continuing session on page: ${location.href}`);
  const relayResponse = await withTimeout(
    chrome.runtime.sendMessage({
      type: MSG.RUN_SESSION_AUTOFILL,
      data: {
        profile,
        sessionFilledFieldTypes: session.filledFieldTypes,
      },
    }) as Promise<SessionAutofillRelayResponse>,
    22000,
    "Session relay autofill"
  );

  if (!relayResponse?.success) {
    throw new Error(relayResponse?.error ?? "Session relay autofill failed");
  }

  const total = relayResponse.total ?? 0;
  const filled = relayResponse.filled ?? 0;
  const skipped = relayResponse.skipped ?? 0;
  sendProgress({
    state: "complete",
    total,
    filled,
    manual: 0,
    skipped,
    currentField: null,
    currentAction: null,
    paused: false,
    completed: true,
    sessionComplete: false,
    stepIndex: 0,
    fields: [],
    activeBlocker: null,
    validationErrors: [],
    lastFilledField: null,
  });
  return filled;
}

function startSessionWatcher(): void {
  if (window !== window.top || sessionWatcherStarted) return;
  sessionWatcherStarted = true;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let urlPollTimer: ReturnType<typeof setInterval> | null = null;
  let stopPassiveMonitor: (() => void) | null = null;
  let unpatchHistory: (() => void) | null = null;
  let watchersInstalled = false;
  let lastUrl = location.href;

  const teardown = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (urlPollTimer) {
      clearInterval(urlPollTimer);
      urlPollTimer = null;
    }
    if (stopPassiveMonitor) {
      stopPassiveMonitor();
      stopPassiveMonitor = null;
    }
    if (unpatchHistory) {
      unpatchHistory();
      unpatchHistory = null;
    }
    watchersInstalled = false;
    autofillRunInProgress = false;
    removeSessionBadge();
  };
  sessionWatcherCleanup = teardown;

  const triggerContinuation = async (reason: string) => {
    if (autofillRunInProgress) return;
    const session = await getActiveSession();
    if (!session) {
      teardown();
      return;
    }

    if (isSuccessPage()) {
      emitDiagTrace("Session", `Success page detected (${reason}); ending session`);
      chrome.runtime
        .sendMessage({ type: MSG.AUTOFILL_SESSION_CANCEL, data: { reason: "success_page" } })
        .catch(() => {});
      teardown();
      return;
    }

    showSessionBadge();
    autofillRunInProgress = true;
    try {
      await runSessionFillPass(session);
    } catch (err) {
      emitDiagTrace(
        "Session",
        `Session continuation failed: ${err instanceof Error ? err.message : String(err)}`,
        "warn"
      );
    } finally {
      autofillRunInProgress = false;
    }
  };

  const scheduleContinuation = (reason: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void triggerContinuation(reason);
    }, 400);
  };

  const installWatchers = () => {
    if (watchersInstalled) return;
    stopPassiveMonitor = startPassiveFormMonitor(() => scheduleContinuation("dom_mutation"));
    unpatchHistory = patchHistoryAPI(() => scheduleContinuation("history_change"));
    urlPollTimer = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleContinuation("url_poll");
      }
    }, 1000);
    watchersInstalled = true;
  };

  requestSessionWatcherActivation = (runInitialPass: boolean) => {
    void (async () => {
      const session = await getActiveSession();
      if (!session) return;
      showSessionBadge();
      installWatchers();
      if (runInitialPass) {
        await sleep(800);
        await triggerContinuation("initial_load");
      }
    })();
  };

  requestSessionWatcherActivation(true);
}

startSessionWatcher();
