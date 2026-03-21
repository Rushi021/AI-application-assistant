export type CheckboxClassification = "agreement" | "profile";

export interface ScannedRadioOption {
  selector: string;
  id: string | null;
  name: string | null;
  label: string;
  checked: boolean;
  disabled: boolean;
  value: string;
}

export interface ScannedRadioGroup {
  name: string;
  options: ScannedRadioOption[];
}

export interface ScannedCheckbox {
  selector: string;
  id: string | null;
  name: string | null;
  label: string;
  checked: boolean;
  disabled: boolean;
  classification: CheckboxClassification;
}

export interface ScannedDropdown {
  selector: string;
  label: string;
  pattern: string;
  expanded: string | null;
}

export interface RadioTestItemResult {
  groupName: string;
  before: string;
  action: string;
  after: string;
  success: boolean;
  detail?: string;
}

export interface CheckboxTestItemResult {
  selector: string;
  label: string;
  classification: CheckboxClassification;
  before: boolean;
  action: string;
  after: boolean;
  success: boolean;
  detail?: string;
}

export interface DropdownTestItemResult {
  selector: string;
  label: string;
  pattern: string;
  beforeExpanded: string | null;
  action: string;
  afterExpanded: string | null;
  optionsFound: number;
  success: boolean;
  detail?: string;
}

export interface RadioTestDiagnostics {
  receivedCount: number;
  domTotalRadios: number;
  perNameCounts: Record<string, number>;
}

export interface CheckboxTestDiagnostics {
  receivedCount: number;
  domTotalCheckboxes: number;
  perIdCounts: Record<string, number>;
}

export interface CheckboxDescriptor {
  id: string | null;
  selector: string;
  label: string;
  classification: CheckboxClassification;
}

export interface DropdownDescriptor {
  selector: string;
  label: string;
  pattern: string;
}

export type UploadDetectorSubType = "resume" | "cover_letter" | "generic";

export interface ScannedUploadFileInput {
  selector: string;
  id: string | null;
  name: string | null;
  label: string;
  visible: boolean;
  hasFiles: boolean;
  accept: string | null;
  signals: string[];
}

export interface ScannedUploadTrigger {
  selector: string;
  tag: string;
  text: string;
  source: "visible_trigger";
}

export interface UploadDetectorCandidate {
  selector: string;
  label: string;
  subType: UploadDetectorSubType;
  source: "visible_file_input" | "hidden_file_input_with_trigger" | "trigger_only";
  triggerTexts: string[];
  signals: string[];
}

export interface UploadDetectorRunResult {
  visibleFileInputs: ScannedUploadFileInput[];
  hiddenFileInputs: ScannedUploadFileInput[];
  visibleUploadTriggers: ScannedUploadTrigger[];
  candidates: UploadDetectorCandidate[];
}

export type Phase1CanonicalFieldKey =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "address_line1"
  | "address_line2"
  | "city"
  | "state"
  | "zip_code"
  | "country"
  | "linkedin_url"
  | "portfolio_url"
  | "work_authorization"
  | "sponsorship_needed";

export type Phase1FillAction =
  | "filled"
  | "skipped_unmatched"
  | "skipped_ambiguous"
  | "skipped_no_profile_value"
  | "skipped_sensitive"
  | "skipped_unsupported_type"
  | "skipped_existing_value"
  | "skipped_select_no_match"
  | "failed_write"
  | "failed_verify";

export interface Phase1FieldCandidate {
  selector: string;
  tag: "input" | "textarea" | "select";
  inputType: string;
  label: string;
  required: boolean;
  enabled: boolean;
  signals: string[];
  signalsWithSource: Array<{ source: string; value: string }>;
  currentValue: string;
  isSensitive: boolean;
}

export interface Phase1FieldMatch {
  matchedKey: Phase1CanonicalFieldKey | null;
  confidence: number;
  profileValue: string | null;
  action:
    | "matched"
    | "skipped_unmatched"
    | "skipped_ambiguous"
    | "skipped_no_profile_value"
    | "skipped_sensitive"
    | "skipped_unsupported_type";
  reason: string;
}

export interface Phase1FillResult {
  selector: string;
  fieldType: string;
  canonicalKey: Phase1CanonicalFieldKey | null;
  label: string;
  signals: string[];
  action: Phase1FillAction;
  before: string;
  attemptedValue: string | null;
  after: string;
  verified: boolean;
  reason: string;
}

export interface Phase1RunResult {
  candidates: Phase1FieldCandidate[];
  results: Phase1FillResult[];
}

export interface UnifiedAutofillRunResult {
  candidates: Phase1FieldCandidate[];
  results: Phase1FillResult[];
  phase1Results: Phase1FillResult[];
  radioResults: Phase1FillResult[];
  checkboxResults: Phase1FillResult[];
  dropdownResults: Phase1FillResult[];
}

const AGREEMENT_PATTERN = /agree|consent|acknowledge|accept|terms|privacy|authorized/i;
const EEOC_PATTERN = /gender|race|ethnic|ethnicity|sexual|orientation|veteran|disability|eeo/i;
const SENSITIVE_PHASE1_PATTERN =
  /gender|race|ethnic|ethnicity|sexual|orientation|veteran|disability|eeo|self identify/i;
const DROPDOWN_SELECTOR = '[role="combobox"], [aria-haspopup="listbox"], .ant-select-selector, [class*="ant-select-selector"], [class*="MuiSelect-select"], [class*="MuiAutocomplete-inputRoot"], [class*="react-select__control"], [class*="select__control"]';
const UPLOAD_TRIGGER_SELECTOR = 'button, [role="button"], label, a, span, div';
const UPLOAD_TRIGGER_TEXT_PATTERN =
  /upload|attach|resume|cv|curriculum|cover.?letter|dropbox|onedrive|google drive|from pc|browse|drag|drop/i;
const UPLOAD_NOISE_PATTERN =
  /api_key|extensions?:|awliwidget|linkedin\.com\/talentwidgets|usersessionenabled|undefined/i;

const PHASE1_TYPE_ALLOWLIST = new Set([
  "text",
  "email",
  "tel",
  "search",
  "url",
  "",
  "textarea",
  "select-one",
]);

const PHASE1_AUTOCOMPLETE_MAP: Record<string, Phase1CanonicalFieldKey> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "street-address": "address_line1",
  "address-line1": "address_line1",
  "address-line2": "address_line2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip_code",
  country: "country",
  url: "portfolio_url",
};

const PHASE1_FIELD_PATTERNS: Record<Phase1CanonicalFieldKey, RegExp[]> = {
  first_name: [/first.?name/i, /given.?name/i, /fname/i, /^first$/i],
  last_name: [/last.?name/i, /family.?name/i, /surname/i, /lname/i, /^last$/i],
  full_name: [/full.?name/i, /^name$/i, /legal.?name/i, /candidate.?name/i],
  email: [/e.?mail/i, /email.?address/i, /^email$/i],
  phone: [/phone/i, /mobile/i, /cell/i, /tel/i, /contact.?number/i],
  address_line1: [/address.?line.?1/i, /street.?address/i, /^address$/i, /mailing.?address/i],
  address_line2: [/address.?line.?2/i, /\bapt\b/i, /\bsuite\b/i, /\bunit\b/i],
  city: [/^city$/i, /city.?name/i, /town/i, /location.*city/i, /city.*location/i, /^location\s*\(city\)\s*$/i],
  state: [/^state$/i, /province/i, /region/i],
  zip_code: [/zip/i, /postal/i, /post.?code/i],
  country: [/country/i, /nation/i],
  linkedin_url: [/linkedin/i, /linked.?in/i],
  portfolio_url: [/portfolio/i, /website/i, /personal.?site/i, /\bblog\b/i],
  work_authorization: [/work.?auth/i, /authorized.?to.?work/i, /legally.?authorized/i, /eligible.?to.?work/i],
  sponsorship_needed: [/sponsor/i, /visa.?sponsor/i, /require.?sponsor/i, /future.?sponsor/i],
};

const PHASE1_SOURCE_WEIGHTS: Record<string, number> = {
  autocomplete: 12,
  type: 8,
  "aria-label": 7,
  label: 7,
  name: 5,
  id: 4,
  placeholder: 4,
  nearby: 2,
};

type Phase1FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function normalizePhase1Value(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getNearbyText(el: Element, levels = 2): string | null {
  let node: Element | null = el.parentElement;
  for (let i = 0; i < levels && node; i++) {
    const text = node.textContent?.trim().slice(0, 120);
    if (text && text.length > 2) return text;
    node = node.parentElement;
  }
  return null;
}

function getPhase1SignalsWithSource(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): Array<{ source: string; value: string }> {
  const out: Array<{ source: string; value: string }> = [];
  const autocomplete = el.getAttribute("autocomplete");
  if (autocomplete) out.push({ source: "autocomplete", value: autocomplete });
  if (el instanceof HTMLInputElement && el.type) out.push({ source: "type", value: el.type });
  if (el.name) out.push({ source: "name", value: el.name });
  if (el.id) out.push({ source: "id", value: el.id });
  if ("placeholder" in el && el.placeholder) out.push({ source: "placeholder", value: el.placeholder });
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) out.push({ source: "aria-label", value: ariaLabel });
  const label = getAssociatedLabelText(el);
  if (label) out.push({ source: "label", value: label });
  const nearby = getNearbyText(el);
  if (nearby) out.push({ source: "nearby", value: nearby });
  return out;
}

function getBasicSignals(el: HTMLInputElement): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = value?.trim();
    if (text) out.push(text);
  };
  push(el.name);
  push(el.id);
  push(el.getAttribute("aria-label"));
  push(el.getAttribute("accept"));
  push(el.getAttribute("data-automation-id"));
  push(el.getAttribute("data-testid"));
  push(getAssociatedLabelText(el));
  return out;
}

function normalizeUploadText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > 180) return null;
  if (UPLOAD_NOISE_PATTERN.test(text)) return null;
  return text;
}

function resolvePhase1ProfileValue(
  key: Phase1CanonicalFieldKey,
  profile: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    country?: string | null;
    linkedin_url?: string | null;
    portfolio_url?: string | null;
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  }
): string | null {
  switch (key) {
    case "first_name":
      return profile.full_name?.trim().split(/\s+/)[0] ?? null;
    case "last_name": {
      const parts = profile.full_name?.trim().split(/\s+/) ?? [];
      return parts.length > 1 ? parts.slice(1).join(" ") : null;
    }
    case "full_name":
      return profile.full_name ?? null;
    case "email":
      return profile.email ?? null;
    case "phone":
      return profile.phone ?? null;
    case "address_line1":
      return profile.address_line1 ?? null;
    case "address_line2":
      return profile.address_line2 ?? null;
    case "city":
      return profile.city ?? null;
    case "state":
      return profile.state ?? null;
    case "zip_code":
      return profile.zip_code ?? null;
    case "country":
      return profile.country ?? null;
    case "linkedin_url":
      return profile.linkedin_url ?? null;
    case "portfolio_url":
      return profile.portfolio_url ?? null;
    case "work_authorization":
      return profile.work_authorization ?? null;
    case "sponsorship_needed":
      return profile.sponsorship_needed == null ? null : profile.sponsorship_needed ? "Yes" : "No";
    default:
      return null;
  }
}

function findSelectOption(select: HTMLSelectElement, targetValue: string): HTMLOptionElement | null {
  const normalizedTarget = normalizePhase1Value(targetValue);
  const options = Array.from(select.options).filter((option) => option.value || option.textContent?.trim());
  const exactValue = options.find((option) => normalizePhase1Value(option.value) === normalizedTarget);
  if (exactValue) return exactValue;
  const exactText = options.find((option) => normalizePhase1Value(option.textContent ?? "") === normalizedTarget);
  if (exactText) return exactText;
  return (
    options.find((option) => {
      const normalizedText = normalizePhase1Value(option.textContent ?? "");
      const normalizedValue = normalizePhase1Value(option.value);
      return (
        normalizedText.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedText) ||
        normalizedValue.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedValue)
      );
    }) ?? null
  );
}

function setTextLikeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  el.focus();
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

export function isVisibleElement(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

export function safeCssEscape(value: string): string {
  if (typeof window.CSS !== "undefined" && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, "\\$&");
}

export function getElementSelector(el: Element): string {
  if (!(el instanceof HTMLElement)) return el.tagName.toLowerCase();
  if (el.id) return `#${safeCssEscape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const isUnique = (selector: string): boolean => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const name = el.getAttribute("name");
  if (name) {
    const selector = `${tag}[name="${safeCssEscape(name)}"]`;
    if (isUnique(selector)) return selector;
  }
  const dataQa = el.getAttribute("data-qa");
  if (dataQa) {
    const selector = `${tag}[data-qa="${safeCssEscape(dataQa)}"]`;
    if (isUnique(selector)) return selector;
  }
  const dataAutomationId = el.getAttribute("data-automation-id");
  if (dataAutomationId) {
    const selector = `${tag}[data-automation-id="${safeCssEscape(dataAutomationId)}"]`;
    if (isUnique(selector)) return selector;
  }
  const dataTestId = el.getAttribute("data-testid");
  if (dataTestId) {
    const selector = `${tag}[data-testid="${safeCssEscape(dataTestId)}"]`;
    if (isUnique(selector)) return selector;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = el;
  while (current) {
    const currentTag = current.tagName.toLowerCase();
    let part = currentTag;
    const parent: HTMLElement | null = current.parentElement;

    if (current.id) {
      part = `${currentTag}#${safeCssEscape(current.id)}`;
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (isUnique(selector)) return selector;
      return `#${safeCssEscape(current.id)}`;
    }

    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (child) => child instanceof HTMLElement && child.tagName.toLowerCase() === currentTag
      );
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        part = `${currentTag}:nth-of-type(${index})`;
      }
    }

    parts.unshift(part);
    const selector = parts.join(" > ");
    if (isUnique(selector)) return selector;
    current = parent;
  }

  return parts.join(" > ") || tag;
}

function queryElementBySelectorDeep(root: Document | ShadowRoot, selector: string): Element | null {
  try {
    const direct = root.querySelector(selector);
    if (direct) return direct;
  } catch {
    // ignore invalid selector and fallback to deep matching
  }

  const candidates = deepQueryAll(root, "input, textarea, select, [role='combobox'], [role='radio'], [aria-pressed], label, button");
  for (const candidate of candidates) {
    if (getElementSelector(candidate) === selector) return candidate;
  }
  return null;
}

export function getLabelTextForElement(el: HTMLElement): string {
  const withLabels = el as HTMLInputElement & { labels?: NodeListOf<HTMLLabelElement> };
  if (withLabels.labels?.length) {
    const labelText = Array.from(withLabels.labels)
      .map((l) => l.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (labelText) return labelText;
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ").slice(0, 200);
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim().slice(0, 200);
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) {
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    const text = clone.textContent?.trim();
    if (text && text.length < 200) return text;
  }
  if ("placeholder" in el && (el as HTMLInputElement).placeholder) {
    return (el as HTMLInputElement).placeholder.trim().slice(0, 200);
  }
  const parent = el.parentElement;
  if (parent) {
    const prev = el.previousElementSibling;
    if (prev) {
      const tag = prev.tagName.toLowerCase();
      if (tag === "label" || tag === "span" || tag === "div") {
        const t = prev.textContent?.trim();
        if (t && t.length < 60) return t;
      }
    }
    for (const candidate of parent.querySelectorAll(":scope > label, :scope > span, :scope > div")) {
      const t = candidate.textContent?.trim();
      if (t && t.length < 60 && candidate !== el) return t;
    }
  }
  return "";
}

export function getAssociatedLabelText(el: HTMLElement): string | null {
  const fromSmart = getLabelTextForElement(el);
  if (fromSmart) return fromSmart;
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label")!.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) {
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  return null;
}

export function getInputChoiceLabel(el: HTMLInputElement): string {
  if (el.id) {
    const byFor = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim();
    if (byFor) return byFor;
  }
  const wrapped = el.closest("label")?.textContent?.trim();
  if (wrapped) return wrapped;
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const next = el.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE && next.textContent?.trim()) return next.textContent.trim();
  const nextElement = el.nextElementSibling?.textContent?.trim();
  if (nextElement) return nextElement;
  return el.value || el.name || el.id || "(unlabeled)";
}

export function classifyCheckboxLabel(label: string): CheckboxClassification {
  return AGREEMENT_PATTERN.test(label) ? "agreement" : "profile";
}

export function isEeocLike(text: string): boolean {
  return EEOC_PATTERN.test(text);
}

export function scanPhase1Candidates(root: Document | ShadowRoot = document): Phase1FieldCandidate[] {
  const elements = deepQueryAll(
    root,
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select'
  ).filter(
    (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  );

  return elements
    .filter((el) => isVisibleElement(el))
    .map((el) => {
      const tag = el.tagName.toLowerCase() as "input" | "textarea" | "select";
      const inputType =
        el instanceof HTMLTextAreaElement ? "textarea" : el instanceof HTMLSelectElement ? "select-one" : el.type ?? "text";
      const signalsWithSource = getPhase1SignalsWithSource(el);
      const signals = signalsWithSource.map((item) => item.value);
      const label = getAssociatedLabelText(el) || getLabelTextForElement(el) || el.name || el.id || "(unlabeled)";
      const combined = [label, ...signals].join(" ");
      return {
        selector: getElementSelector(el),
        tag,
        inputType,
        label,
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
        enabled: !el.disabled && !el.hasAttribute("readonly"),
        signals,
        signalsWithSource,
        currentValue: el instanceof HTMLSelectElement ? el.value || el.selectedOptions[0]?.textContent?.trim() || "" : el.value ?? "",
        isSensitive: SENSITIVE_PHASE1_PATTERN.test(combined),
      } satisfies Phase1FieldCandidate;
    });
}

export function classifyPhase1SkipReason(candidate: Phase1FieldCandidate): Phase1FieldMatch["action"] | null {
  if (candidate.isSensitive) return "skipped_sensitive";
  if (!candidate.enabled) return "skipped_unsupported_type";
  if (!PHASE1_TYPE_ALLOWLIST.has(candidate.inputType)) return "skipped_unsupported_type";
  if (candidate.tag === "select" && !["country", "state"].some((key) => candidate.signals.some((s) => s.toLowerCase().includes(key)))) {
    return "skipped_unsupported_type";
  }
  return null;
}

export function matchPhase1Field(
  candidate: Phase1FieldCandidate,
  profile: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    country?: string | null;
    linkedin_url?: string | null;
    portfolio_url?: string | null;
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  }
): Phase1FieldMatch {
  const skip = classifyPhase1SkipReason(candidate);
  if (skip) {
    return {
      matchedKey: null,
      confidence: 0,
      profileValue: null,
      action: skip,
      reason: skip === "skipped_sensitive" ? "Sensitive or EEO-like field" : "Unsupported Phase 1 field type",
    };
  }

  const scores = new Map<Phase1CanonicalFieldKey, { score: number; reasons: string[] }>();
  for (const { source, value } of candidate.signalsWithSource) {
    const normalized = value.toLowerCase().trim();
    const sourceWeight = PHASE1_SOURCE_WEIGHTS[source] ?? 2;
    if (source === "autocomplete") {
      const mapped = PHASE1_AUTOCOMPLETE_MAP[normalized];
      if (mapped) {
        const current = scores.get(mapped) ?? { score: 0, reasons: [] };
        current.score += sourceWeight;
        current.reasons.push(`autocomplete:${mapped}`);
        scores.set(mapped, current);
      }
    }
    if (source === "type" && (normalized === "email" || normalized === "tel")) {
      const mapped = normalized === "email" ? "email" : "phone";
      const current = scores.get(mapped) ?? { score: 0, reasons: [] };
      current.score += sourceWeight;
      current.reasons.push(`type:${mapped}`);
      scores.set(mapped, current);
    }

    for (const [key, patterns] of Object.entries(PHASE1_FIELD_PATTERNS) as Array<
      [Phase1CanonicalFieldKey, RegExp[]]
    >) {
      if (patterns.some((pattern) => pattern.test(value))) {
        const current = scores.get(key) ?? { score: 0, reasons: [] };
        current.score += sourceWeight;
        current.reasons.push(`${source}:${key}`);
        scores.set(key, current);
      }
    }
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0) {
    return {
      matchedKey: null,
      confidence: 0,
      profileValue: null,
      action: "skipped_unmatched",
      reason: "No Phase 1 match pattern matched this field",
    };
  }

  const [bestKey, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1].score ?? -1;
  if (secondScore >= 0 && bestScore.score - secondScore <= 2) {
    return {
      matchedKey: null,
      confidence: bestScore.score,
      profileValue: null,
      action: "skipped_ambiguous",
      reason: `Ambiguous match between ${bestKey} and ${ranked[1][0]}`,
    };
  }

  const profileValue = resolvePhase1ProfileValue(bestKey, profile);
  if (!profileValue || normalizePhase1Value(profileValue).length === 0) {
    return {
      matchedKey: bestKey,
      confidence: bestScore.score,
      profileValue: null,
      action: "skipped_no_profile_value",
      reason: `Profile has no value for ${bestKey}`,
    };
  }

  return {
    matchedKey: bestKey,
    confidence: bestScore.score,
    profileValue,
    action: "matched",
    reason: bestScore.reasons[0] ?? `matched:${bestKey}`,
  };
}

export function fillPhase1Field(
  element: Phase1FillableElement,
  value: string
): { before: string; after: string; success: boolean; reason: string } {
  const before =
    element instanceof HTMLSelectElement ? element.value || element.selectedOptions[0]?.textContent?.trim() || "" : element.value ?? "";

  if (element instanceof HTMLSelectElement) {
    const option = findSelectOption(element, value);
    if (!option) {
      return { before, after: before, success: false, reason: "No deterministic select option match" };
    }
    element.focus();
    element.value = option.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    const after = element.value || element.selectedOptions[0]?.textContent?.trim() || "";
    return { before, after, success: normalizePhase1Value(after) === normalizePhase1Value(value), reason: "Select updated" };
  }

  setTextLikeValue(element, value);
  const after = element.value ?? "";
  return {
    before,
    after,
    success: normalizePhase1Value(after) === normalizePhase1Value(value),
    reason: "Native setter + input/change/blur events dispatched",
  };
}

export function verifyPhase1Write(element: Phase1FillableElement, expectedValue: string): boolean {
  const current =
    element instanceof HTMLSelectElement ? element.value || element.selectedOptions[0]?.textContent?.trim() || "" : element.value ?? "";
  return normalizePhase1Value(current) === normalizePhase1Value(expectedValue);
}

type BinaryChoiceValue = "yes" | "no";

const WORK_AUTH_QUESTION_PATTERN =
  /authorized\s+to\s+work|legally\s+authorized|eligible\s+to\s+work|legal\s+right\s+to\s+work|work\s+in\s+the\s+u\.?s|work\s+in\s+u\.?s|work\s+in\s+canada|work\s+in\s+the\s+u\.?s\s+or\s+canada/i;
const SPONSORSHIP_QUESTION_PATTERN =
  /require\s+visa\s+sponsorship|visa\s+sponsorship|future\s+require\s+sponsorship|now\s+or\s+in\s+the\s+future\s+require\s+sponsorship|need\s+sponsorship/i;
const MILITARY_QUESTION_PATTERN =
  /served\s+in\s+the\s+military|military\s+service|veteran|protected\s+veteran|armed\s+forces|reservist|national\s+guard|uniformed\s+services|military\s+spouse|government\s+or\s+military|connected\s+to\s+government|related\s+to\s+the\s+government/i;
const MILITARY_NEGATIVE_ANSWER_PATTERN =
  /\bno\b|not\s+a?\s*(protected\s+)?veteran|not\s+served|never\s+served|none|not\s+affiliated|not\s+connected|i\s+do\s+not/i;
const MILITARY_POSITIVE_ANSWER_PATTERN =
  /\byes\b|served|veteran|protected\s+veteran|active\s+duty|military\s+spouse|reservist|national\s+guard|armed\s+forces/i;
const MILITARY_SIGNAL_SOURCES = new Set(["label", "aria-label", "name", "id", "placeholder"]);

function toBinaryChoiceToken(text: string): BinaryChoiceValue | null {
  const normalized = normalizePhase1Value(text);
  if (!normalized) return null;
  if (
    /^(yes|y|true|authorized)$/i.test(normalized) ||
    ((/\byes\b/i.test(normalized) || /\bauthorized\b|\beligible\b/i.test(normalized)) && !/\bno\b/i.test(normalized))
  ) {
    return "yes";
  }
  if (
    /^(no|n|false|not authorized)$/i.test(normalized) ||
    /\bno\b|\bnot authorized\b|\bnot eligible\b/i.test(normalized)
  ) {
    return "no";
  }
  return null;
}

function inferWorkAuthorizationChoice(value: string | null | undefined): BinaryChoiceValue | null {
  const normalized = normalizePhase1Value(value);
  if (!normalized) return null;
  if (/^(yes|y|true)$/i.test(normalized)) return "yes";
  if (/^(no|n|false)$/i.test(normalized)) return "no";
  if (/not\s+authorized|not\s+eligible|cannot\s+work|unable\s+to\s+work/i.test(normalized)) return "no";
  if (/authorized|eligible|citizen|permanent\s+resident|green\s*card|can\s+work/i.test(normalized)) return "yes";
  return null;
}

function isMilitaryQuestionText(text: string | null | undefined): boolean {
  const normalized = normalizePhase1Value(text);
  if (!normalized) return false;
  return MILITARY_QUESTION_PATTERN.test(normalized);
}

function toMilitaryChoiceToken(text: string): BinaryChoiceValue | null {
  const normalized = normalizePhase1Value(text);
  if (!normalized) return null;
  if (MILITARY_NEGATIVE_ANSWER_PATTERN.test(normalized)) return "no";
  if (MILITARY_POSITIVE_ANSWER_PATTERN.test(normalized)) {
    if (/\bnot\b/.test(normalized) && !/\byes\b/.test(normalized)) return "no";
    return "yes";
  }
  return null;
}

function getCandidatePolicyText(candidate: Phase1FieldCandidate): string {
  const highSignal = candidate.signalsWithSource
    .filter((item) => MILITARY_SIGNAL_SOURCES.has(item.source))
    .map((item) => item.value);
  const joined = [candidate.label, ...highSignal].join(" ");
  return joined.replace(/\s+/g, " ").trim();
}

function findMilitaryNoSelectOption(select: HTMLSelectElement): HTMLOptionElement | null {
  const options = Array.from(select.options).filter((option) => option.value || option.textContent?.trim());
  const explicitNo = options.find((option) => normalizePhase1Value(option.value) === "no");
  if (explicitNo) return explicitNo;
  const explicitNoText = options.find((option) => normalizePhase1Value(option.textContent ?? "") === "no");
  if (explicitNoText) return explicitNoText;
  return (
    options.find((option) => {
      const text = normalizePhase1Value(`${option.textContent ?? ""} ${option.value ?? ""}`);
      return toMilitaryChoiceToken(text) === "no";
    }) ?? null
  );
}

function fillMilitaryNoField(
  element: Phase1FillableElement
): { before: string; after: string; success: boolean; reason: string } {
  const before =
    element instanceof HTMLSelectElement ? element.value || element.selectedOptions[0]?.textContent?.trim() || "" : element.value ?? "";
  if (element instanceof HTMLSelectElement) {
    const option = findMilitaryNoSelectOption(element) ?? findSelectOption(element, "No");
    if (!option) {
      return { before, after: before, success: false, reason: "No deterministic military NO option found" };
    }
    element.focus();
    element.value = option.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    const after = element.value || element.selectedOptions[0]?.textContent?.trim() || "";
    const verified = toMilitaryChoiceToken(after) === "no" || toMilitaryChoiceToken(option.textContent ?? "") === "no";
    return { before, after, success: verified, reason: "Military policy applied with NO option" };
  }

  setTextLikeValue(element, "No");
  const after = element.value ?? "";
  return {
    before,
    after,
    success: normalizePhase1Value(after) === "no",
    reason: "Military policy applied as literal 'No'",
  };
}

function getRadioFromLabel(label: HTMLLabelElement): HTMLInputElement | null {
  const htmlFor = label.getAttribute("for");
  if (htmlFor) {
    const byFor = document.getElementById(htmlFor);
    if (byFor instanceof HTMLInputElement && byFor.type === "radio") return byFor;
  }
  const nested = label.querySelector('input[type="radio"]');
  return nested instanceof HTMLInputElement ? nested : null;
}

function getBinaryControlText(el: Element): string {
  if (el instanceof HTMLInputElement && el.type === "radio") {
    return `${getInputChoiceLabel(el)} ${el.value ?? ""}`.trim();
  }
  if (el instanceof HTMLLabelElement) {
    const linkedRadio = getRadioFromLabel(el);
    return `${el.textContent ?? ""} ${linkedRadio?.value ?? ""}`.trim();
  }
  if (el instanceof HTMLElement) {
    return `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.trim();
  }
  return "";
}

function isBinaryControlSelected(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.type === "radio") return el.checked;
  if (el instanceof HTMLLabelElement) return !!getRadioFromLabel(el)?.checked;
  if (el instanceof HTMLElement) {
    const ariaChecked = el.getAttribute("aria-checked");
    if (ariaChecked) return ariaChecked === "true";
    const ariaPressed = el.getAttribute("aria-pressed");
    if (ariaPressed) return ariaPressed === "true";
    const ariaCurrent = el.getAttribute("aria-current");
    if (ariaCurrent && ariaCurrent !== "false") return true;
    const dataState = el.getAttribute("data-state");
    if (dataState && /^(on|checked|selected|active|true)$/i.test(dataState)) return true;
    const className = el.className || "";
    if (typeof className === "string" && /\b(selected|active|checked|is-selected)\b/i.test(className)) return true;
  }
  return false;
}

function dispatchSyntheticClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function clickBinaryControl(el: Element): void {
  if (el instanceof HTMLLabelElement) {
    el.click();
    dispatchSyntheticClick(el);
    const linkedRadio = getRadioFromLabel(el);
    if (linkedRadio) {
      linkedRadio.dispatchEvent(new Event("input", { bubbles: true }));
      linkedRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  if (el instanceof HTMLInputElement && el.type === "radio") {
    const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
    if (checkedSetter) checkedSetter.call(el, true);
    else el.checked = true;
    el.click();
    dispatchSyntheticClick(el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLElement) {
    el.click();
    dispatchSyntheticClick(el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function getBinarySelectionState(yesControl: Element | null, noControl: Element | null): string {
  if (yesControl && isBinaryControlSelected(yesControl)) return "Yes";
  if (noControl && isBinaryControlSelected(noControl)) return "No";
  return "";
}

function fillKnownBinaryQuestion(
  root: Document | ShadowRoot,
  key: "work_authorization" | "sponsorship_needed" | "military_status",
  pattern: RegExp,
  expectedChoice: BinaryChoiceValue | null
): Phase1FillResult | null {
  const canonicalKey = key === "military_status" ? null : key;
  const baseResult: Omit<Phase1FillResult, "action" | "after" | "verified" | "reason"> = {
    selector: `__binary_${key}`,
    fieldType: "binary_choice",
    canonicalKey,
    label: key,
    signals: [],
    before: "",
    attemptedValue: expectedChoice === null ? null : expectedChoice === "yes" ? "Yes" : "No",
  };

  const questionNodes = Array.from(
    root.querySelectorAll<HTMLElement>("legend, label, p, span, div, h1, h2, h3, h4")
  ).filter((node) => {
    if (!isVisibleElement(node)) return false;
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return text.length >= 20 && text.length <= 220 && pattern.test(text);
  });
  if (questionNodes.length === 0) return null;

  if (!expectedChoice) {
    const firstQuestionText = questionNodes[0]?.textContent?.replace(/\s+/g, " ").trim() ?? key;
    return {
      ...baseResult,
      label: firstQuestionText.slice(0, 200),
      signals: [firstQuestionText],
      action: "skipped_no_profile_value",
      after: "",
      verified: false,
      reason: key === "military_status" ? "Military policy value unavailable" : `Profile has no deterministic ${key} value`,
    };
  }

  const controls = Array.from(
    root.querySelectorAll<Element>('input[type="radio"], label, button, [role="radio"], [aria-pressed]')
  ).filter((control) => {
    if (!(control instanceof HTMLElement)) return false;
    if (!isVisibleElement(control)) return false;
    if (control instanceof HTMLInputElement && control.disabled) return false;
    return true;
  });

  for (const questionNode of questionNodes) {
    const questionText = questionNode.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const qRect = questionNode.getBoundingClientRect();
    if (qRect.width === 0 || qRect.height === 0) continue;

    let bestYes: { el: Element; score: number } | null = null;
    let bestNo: { el: Element; score: number } | null = null;

    for (const control of controls) {
      const choice = toBinaryChoiceToken(getBinaryControlText(control));
      if (!choice) continue;
      const cRect = (control as HTMLElement).getBoundingClientRect();
      const dy = cRect.top - qRect.bottom;
      const dx = Math.abs(cRect.left - qRect.left);
      if (dy < -40 || dy > 260 || dx > 500) continue;
      const score = Math.abs(dy) + dx / 25;
      if (choice === "yes" && (!bestYes || score < bestYes.score)) bestYes = { el: control, score };
      if (choice === "no" && (!bestNo || score < bestNo.score)) bestNo = { el: control, score };
    }

    const target = expectedChoice === "yes" ? bestYes?.el ?? null : bestNo?.el ?? null;
    if (!target) continue;

    const before = getBinarySelectionState(bestYes?.el ?? null, bestNo?.el ?? null);
    clickBinaryControl(target);
    const fallbackMatchedRadio = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some((radio) => {
      if (!radio.checked) return false;
      const token = toBinaryChoiceToken(`${getInputChoiceLabel(radio)} ${radio.value ?? ""}`);
      if (token !== expectedChoice) return false;
      const rect = radio.getBoundingClientRect();
      const dy = rect.top - qRect.bottom;
      const dx = Math.abs(rect.left - qRect.left);
      return dy >= -80 && dy <= 300 && dx <= 560;
    });
    const verified = isBinaryControlSelected(target) || fallbackMatchedRadio;
    const afterState = getBinarySelectionState(bestYes?.el ?? null, bestNo?.el ?? null);
    const after = afterState || (verified ? (expectedChoice === "yes" ? "Yes" : "No") : "");

    return {
      selector: getElementSelector(target),
      fieldType: "binary_choice",
      canonicalKey,
      label: questionText.slice(0, 200),
      signals: [questionText],
      action: verified ? "filled" : "failed_write",
      before,
      attemptedValue: expectedChoice === "yes" ? "Yes" : "No",
      after,
      verified,
      reason: verified
        ? key === "military_status"
          ? "Military policy: clicked NO option"
          : `Clicked ${expectedChoice.toUpperCase()} option`
        : "Binary option click did not stick",
    };
  }

  return {
    ...baseResult,
    label: (questionNodes[0]?.textContent?.replace(/\s+/g, " ").trim() ?? key).slice(0, 200),
    signals: [questionNodes[0]?.textContent?.replace(/\s+/g, " ").trim() ?? key],
    action: "skipped_unmatched",
    after: "",
    verified: false,
    reason: "No matching binary question controls detected in this frame",
  };
}

export function runPhase1Fill(
  profile: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    country?: string | null;
    linkedin_url?: string | null;
    portfolio_url?: string | null;
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  },
  root: Document | ShadowRoot = document
): Phase1RunResult {
  const candidates = scanPhase1Candidates(root);
  const results: Phase1FillResult[] = candidates.map((candidate) => {
    const baseResult: Omit<Phase1FillResult, "action" | "after" | "verified" | "reason"> = {
      selector: candidate.selector,
      fieldType: candidate.inputType,
      canonicalKey: null,
      label: candidate.label,
      signals: candidate.signals,
      before: candidate.currentValue,
      attemptedValue: null,
    };

    const militaryPolicyText = getCandidatePolicyText(candidate);
    if (isMilitaryQuestionText(militaryPolicyText)) {
      let element: Phase1FillableElement | null = null;
      const found = queryElementBySelectorDeep(root, candidate.selector);
      if (
        found instanceof HTMLInputElement ||
        found instanceof HTMLTextAreaElement ||
        found instanceof HTMLSelectElement
      ) {
        element = found;
      }
      if (!element) {
        return {
          ...baseResult,
          action: "failed_write",
          after: candidate.currentValue,
          verified: false,
          attemptedValue: "No",
          reason: "Military policy target element not found by selector",
        };
      }
      const fillResult = fillMilitaryNoField(element);
      return {
        ...baseResult,
        action: fillResult.success ? "filled" : "failed_write",
        after: fillResult.after,
        verified: fillResult.success,
        attemptedValue: "No",
        reason: fillResult.success ? "Military policy: always answer No" : fillResult.reason,
      };
    }

    const match = matchPhase1Field(candidate, profile);
    baseResult.canonicalKey = match.matchedKey;
    baseResult.attemptedValue = match.profileValue;

    if (match.action !== "matched" || !match.matchedKey || !match.profileValue) {
      return {
        ...baseResult,
        action: match.action as Phase1FillAction,
        after: candidate.currentValue,
        verified: false,
        reason: match.reason,
      };
    }

    let element: Phase1FillableElement | null = null;
    const found = queryElementBySelectorDeep(root, candidate.selector);
    if (
      found instanceof HTMLInputElement ||
      found instanceof HTMLTextAreaElement ||
      found instanceof HTMLSelectElement
    ) {
      element = found;
    }

    if (!element) {
      return {
        ...baseResult,
        action: "failed_write",
        after: candidate.currentValue,
        verified: false,
        reason: "Element not found by selector at fill time",
      };
    }

    if (normalizePhase1Value(candidate.currentValue).length > 0) {
      if (normalizePhase1Value(candidate.currentValue) === normalizePhase1Value(match.profileValue)) {
        return {
          ...baseResult,
          action: "filled",
          after: candidate.currentValue,
          verified: true,
          reason: "Field already matched the profile value",
        };
      }
      return {
        ...baseResult,
        action: "skipped_existing_value",
        after: candidate.currentValue,
        verified: false,
        reason: "Existing non-empty value differs; Phase 1 did not overwrite it",
      };
    }

    const fillResult = fillPhase1Field(element, match.profileValue);
    if (!fillResult.success && element instanceof HTMLSelectElement) {
      return {
        ...baseResult,
        action: "skipped_select_no_match",
        after: fillResult.after,
        verified: false,
        reason: fillResult.reason,
      };
    }

    const verified = verifyPhase1Write(element, match.profileValue);
    return {
      ...baseResult,
      action: fillResult.success ? (verified ? "filled" : "failed_verify") : "failed_write",
      after: fillResult.after,
      verified,
      reason: verified ? match.reason : fillResult.reason,
    };
  });

  const workAuthorizationChoice = inferWorkAuthorizationChoice(profile.work_authorization);
  const workAuthorizationResult = fillKnownBinaryQuestion(
    root,
    "work_authorization",
    WORK_AUTH_QUESTION_PATTERN,
    workAuthorizationChoice
  );
  if (workAuthorizationResult) results.push(workAuthorizationResult);

  const sponsorshipChoice =
    profile.sponsorship_needed == null ? null : profile.sponsorship_needed ? "yes" : "no";
  const sponsorshipResult = fillKnownBinaryQuestion(
    root,
    "sponsorship_needed",
    SPONSORSHIP_QUESTION_PATTERN,
    sponsorshipChoice
  );
  if (sponsorshipResult) results.push(sponsorshipResult);

  const militaryResult = fillKnownBinaryQuestion(
    root,
    "military_status",
    MILITARY_QUESTION_PATTERN,
    "no"
  );
  if (militaryResult) results.push(militaryResult);

  return { candidates, results };
}

function getElementTextForMatching(el: Element): string {
  const parts: string[] = [];
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    parts.push(el.value ?? "");
    parts.push(el.placeholder ?? "");
    parts.push(el.getAttribute("aria-label") ?? "");
  }
  parts.push(el.textContent ?? "");
  if (el instanceof HTMLElement) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .forEach((value) => parts.push(value));
    }
  }
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCanonicalKeyFromText(text: string): Phase1CanonicalFieldKey | null {
  const ranked = (Object.entries(PHASE1_FIELD_PATTERNS) as Array<[Phase1CanonicalFieldKey, RegExp[]]>)
    .map(([key, patterns]) => ({
      key,
      score: patterns.reduce((acc, pattern) => (pattern.test(text) ? acc + 1 : acc), 0),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  if ((ranked[1]?.score ?? -1) === ranked[0].score) return null;
  return ranked[0].key;
}

function resolveBinaryChoiceForKey(
  key: "work_authorization" | "sponsorship_needed",
  profile: {
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  }
): BinaryChoiceValue | null {
  if (key === "work_authorization") {
    return inferWorkAuthorizationChoice(profile.work_authorization);
  }
  return profile.sponsorship_needed == null ? null : profile.sponsorship_needed ? "yes" : "no";
}

function findNearestQuestionText(el: Element): string {
  const parts: string[] = [];
  const fieldset = el.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend")?.textContent?.trim();
    if (legend) parts.push(legend);
  }
  const parent = el.parentElement;
  if (parent) {
    const local = parent.textContent?.replace(/\s+/g, " ").trim();
    if (local && local.length <= 220) parts.push(local);
  }
  const nearby = getNearbyText(el);
  if (nearby) parts.push(nearby);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function fillKnownRadioGroups(
  profile: {
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  },
  root: Document | ShadowRoot,
  handledBinaryKeys: Set<"work_authorization" | "sponsorship_needed">
): Phase1FillResult[] {
  const groups = scanRadioGroups(root);
  const out: Phase1FillResult[] = [];
  const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;

  for (const group of groups) {
    const firstSelector = group.options[0]?.selector;
    if (!firstSelector) continue;
    let firstEl: HTMLInputElement | null = null;
    const foundFirst = queryElementBySelectorDeep(root, firstSelector);
    firstEl = foundFirst instanceof HTMLInputElement && foundFirst.type === "radio" ? foundFirst : null;
    if (!firstEl) continue;

    const groupText = `${group.name} ${findNearestQuestionText(firstEl)} ${group.options
      .map((opt) => `${opt.label} ${opt.value}`)
      .join(" ")}`.toLowerCase();

    const key: "work_authorization" | "sponsorship_needed" | null = WORK_AUTH_QUESTION_PATTERN.test(groupText)
      ? "work_authorization"
      : SPONSORSHIP_QUESTION_PATTERN.test(groupText)
        ? "sponsorship_needed"
        : null;
    const isMilitaryQuestion = isMilitaryQuestionText(groupText);

    if (!key && !isMilitaryQuestion) continue;
    if (key && handledBinaryKeys.has(key)) continue;
    const expected = isMilitaryQuestion ? "no" : resolveBinaryChoiceForKey(key!, profile);
    const label = findNearestQuestionText(firstEl) || group.name || key || "military_status";
    const beforeOption = group.options.find((opt) => opt.checked);
    const before = beforeOption ? beforeOption.label : "";

    if (!expected) {
      out.push({
        selector: firstSelector,
        fieldType: "radio",
        canonicalKey: isMilitaryQuestion ? null : key,
        label,
        signals: [groupText],
        action: "skipped_no_profile_value",
        before,
        attemptedValue: null,
        after: before,
        verified: false,
        reason: `Profile has no deterministic ${key} value`,
      });
      continue;
    }

    const target = group.options.find((opt) => {
      const token = isMilitaryQuestion
        ? toMilitaryChoiceToken(`${opt.label} ${opt.value}`)
        : toBinaryChoiceToken(`${opt.label} ${opt.value}`);
      return token === expected;
    });

    if (!target) {
      out.push({
        selector: firstSelector,
        fieldType: "radio",
        canonicalKey: isMilitaryQuestion ? null : key,
        label,
        signals: [groupText],
        action: "skipped_unmatched",
        before,
        attemptedValue: expected === "yes" ? "Yes" : "No",
        after: before,
        verified: false,
        reason: isMilitaryQuestion
          ? "No matching military NO option in radio group"
          : "No matching Yes/No option in radio group",
      });
      continue;
    }

    let targetEl: HTMLInputElement | null = null;
    const foundTarget = queryElementBySelectorDeep(root, target.selector);
    targetEl = foundTarget instanceof HTMLInputElement && foundTarget.type === "radio" ? foundTarget : null;
    if (!targetEl) continue;

    if (targetEl.disabled) {
      out.push({
        selector: target.selector,
        fieldType: "radio",
        canonicalKey: isMilitaryQuestion ? null : key,
        label,
        signals: [groupText],
        action: "skipped_unsupported_type",
        before,
        attemptedValue: expected === "yes" ? "Yes" : "No",
        after: before,
        verified: false,
        reason: "Target radio is disabled",
      });
      continue;
    }

    if (targetEl.checked) {
      if (key) handledBinaryKeys.add(key);
      out.push({
        selector: target.selector,
        fieldType: "radio",
        canonicalKey: isMilitaryQuestion ? null : key,
        label,
        signals: [groupText],
        action: "filled",
        before,
        attemptedValue: expected === "yes" ? "Yes" : "No",
        after: target.label,
        verified: true,
        reason: isMilitaryQuestion ? "Military policy: NO option already selected" : "Correct option already selected",
      });
      continue;
    }

    if (checkedSetter) checkedSetter.call(targetEl, true);
    else targetEl.checked = true;
    targetEl.click();
    targetEl.dispatchEvent(new Event("input", { bubbles: true }));
    targetEl.dispatchEvent(new Event("change", { bubbles: true }));

    const verified = targetEl.checked;
    if (verified && key) handledBinaryKeys.add(key);
    const afterOption = group.options.find((opt) => {
      const found = queryElementBySelectorDeep(root, opt.selector);
      return found instanceof HTMLInputElement && found.type === "radio" && found.checked;
    });

    out.push({
      selector: target.selector,
      fieldType: "radio",
      canonicalKey: isMilitaryQuestion ? null : key,
      label,
      signals: [groupText],
      action: verified ? "filled" : "failed_write",
      before,
      attemptedValue: expected === "yes" ? "Yes" : "No",
      after: afterOption?.label ?? "",
      verified,
      reason: verified
        ? isMilitaryQuestion
          ? "Military policy: selected NO option"
          : "Selected matched radio option"
        : "Radio click did not stick",
    });
  }

  return out;
}

function fillKnownCheckboxes(
  profile: {
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  },
  root: Document | ShadowRoot,
  handledBinaryKeys: Set<"work_authorization" | "sponsorship_needed">
): Phase1FillResult[] {
  const out: Phase1FillResult[] = [];
  const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
  const checkboxes = scanCheckboxes(root);

  for (const item of checkboxes) {
    let el: HTMLInputElement | null = null;
    const found = queryElementBySelectorDeep(root, item.selector);
    el = found instanceof HTMLInputElement && found.type === "checkbox" ? found : null;
    if (!el) continue;

    const context = `${item.label} ${findNearestQuestionText(el)}`.toLowerCase();
    const binaryKey: "work_authorization" | "sponsorship_needed" | null = WORK_AUTH_QUESTION_PATTERN.test(context)
      ? "work_authorization"
      : SPONSORSHIP_QUESTION_PATTERN.test(context)
        ? "sponsorship_needed"
        : null;
    const isMilitaryQuestion = isMilitaryQuestionText(context);

    let targetChecked: boolean | null = null;
    let canonicalKey: Phase1CanonicalFieldKey | null = null;
    let reason = "";
    if (binaryKey && !handledBinaryKeys.has(binaryKey)) {
      const expected = resolveBinaryChoiceForKey(binaryKey, profile);
      if (!expected) {
        out.push({
          selector: item.selector,
          fieldType: "checkbox",
          canonicalKey: binaryKey,
          label: item.label,
          signals: [context],
          action: "skipped_no_profile_value",
          before: item.checked ? "checked" : "unchecked",
          attemptedValue: null,
          after: item.checked ? "checked" : "unchecked",
          verified: false,
          reason: `Profile has no deterministic ${binaryKey} value`,
        });
        continue;
      }
      targetChecked = expected === "yes";
      canonicalKey = binaryKey;
      reason = "Matched known binary checkbox";
    } else if (isMilitaryQuestion) {
      targetChecked = toMilitaryChoiceToken(context) === "no";
      canonicalKey = null;
      reason = "Military policy checkbox";
    } else if (item.classification === "agreement") {
      targetChecked = true;
      canonicalKey = null;
      reason = "Agreement checkbox";
    } else {
      continue;
    }

    const before = el.checked ? "checked" : "unchecked";
    if (el.disabled) {
      out.push({
        selector: item.selector,
        fieldType: "checkbox",
        canonicalKey,
        label: item.label,
        signals: [context],
        action: "skipped_unsupported_type",
        before,
        attemptedValue: targetChecked ? "checked" : "unchecked",
        after: before,
        verified: false,
        reason: "Checkbox is disabled",
      });
      continue;
    }

    if (el.checked !== targetChecked) {
      if (checkedSetter) checkedSetter.call(el, targetChecked);
      else el.checked = targetChecked;
      el.click();
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const verified = el.checked === targetChecked;
    if (verified && binaryKey) handledBinaryKeys.add(binaryKey);
    out.push({
      selector: item.selector,
      fieldType: "checkbox",
      canonicalKey,
      label: item.label,
      signals: [context],
      action: verified ? "filled" : "failed_write",
      before,
      attemptedValue: targetChecked ? "checked" : "unchecked",
      after: el.checked ? "checked" : "unchecked",
      verified,
      reason: verified ? reason : "Checkbox value did not stick",
    });
  }

  return out;
}

function getDropdownDisplayValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value?.trim() ?? "";
  }
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel && ariaLabel.length <= 120) return ariaLabel;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getDropdownOptionText(el: Element): string {
  return getElementTextForMatching(el).replace(/\s+/g, " ").trim();
}

function findDropdownOptionElements(): HTMLElement[] {
  const selectors = [
    '[role="option"]',
    '[role="listbox"] [aria-selected]',
    ".ant-select-item-option",
    ".MuiAutocomplete-option",
    ".react-select__option",
    '[id*="option"]',
  ];
  const nodes = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector))
  );
  const deduped = new Set<HTMLElement>();
  for (const node of nodes) {
    if (!isVisibleElement(node)) continue;
    deduped.add(node);
  }
  return Array.from(deduped);
}

function findBestDropdownOption(
  options: HTMLElement[],
  value: string,
  preferMilitaryNo = false
): HTMLElement | null {
  const normalizedTarget = normalizePhase1Value(value);
  if (!normalizedTarget) return null;

  const withText = options
    .map((opt) => ({ opt, text: normalizePhase1Value(getDropdownOptionText(opt)) }))
    .filter((item) => item.text.length > 0);

  const exact = withText.find((item) => item.text === normalizedTarget);
  if (exact) return exact.opt;

  const containing = withText.find(
    (item) =>
      item.text.includes(normalizedTarget) || normalizedTarget.includes(item.text)
  );
  if (containing) return containing.opt;
  if (preferMilitaryNo) {
    const militaryNo = withText.find((item) => toMilitaryChoiceToken(item.text) === "no");
    if (militaryNo) return militaryNo.opt;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fillCustomDropdowns(
  profile: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    country?: string | null;
    linkedin_url?: string | null;
    portfolio_url?: string | null;
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  },
  root: Document | ShadowRoot
): Promise<Phase1FillResult[]> {
  const dropdowns = scanDropdowns(root);
  const out: Phase1FillResult[] = [];

  for (const item of dropdowns) {
    let trigger: HTMLElement | null = null;
    const found = queryElementBySelectorDeep(root, item.selector);
    trigger = found instanceof HTMLElement ? found : null;
    if (!trigger) continue;

    const labelText = `${item.label} ${getElementTextForMatching(trigger)}`.toLowerCase();
    const militaryQuestion = isMilitaryQuestionText(labelText);
    const key = militaryQuestion ? null : detectCanonicalKeyFromText(labelText);
    if (!key && !militaryQuestion) {
      out.push({
        selector: item.selector,
        fieldType: "custom_dropdown",
        canonicalKey: null,
        label: item.label,
        signals: [labelText],
        action: "skipped_unmatched",
        before: getDropdownDisplayValue(trigger),
        attemptedValue: null,
        after: getDropdownDisplayValue(trigger),
        verified: false,
        reason: "Could not match dropdown to a deterministic profile key",
      });
      continue;
    }

    const value = militaryQuestion ? "No" : resolvePhase1ProfileValue(key!, profile);
    const before = getDropdownDisplayValue(trigger);
    if (!value || normalizePhase1Value(value).length === 0) {
      out.push({
        selector: item.selector,
        fieldType: "custom_dropdown",
        canonicalKey: key,
        label: item.label,
        signals: [labelText],
        action: "skipped_no_profile_value",
        before,
        attemptedValue: null,
        after: before,
        verified: false,
        reason: militaryQuestion ? "No deterministic military policy value" : `Profile has no value for ${key}`,
      });
      continue;
    }

    if (normalizePhase1Value(before) === normalizePhase1Value(value)) {
      out.push({
        selector: item.selector,
        fieldType: "custom_dropdown",
        canonicalKey: key,
        label: item.label,
        signals: [labelText],
        action: "filled",
        before,
        attemptedValue: value,
        after: before,
        verified: true,
        reason: militaryQuestion
          ? "Military policy: dropdown already set to NO"
          : "Dropdown already matched profile value",
      });
      continue;
    }

    trigger.click();
    await sleep(120);
    let targetOption: HTMLElement | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const options = findDropdownOptionElements();
      targetOption = findBestDropdownOption(options, value, militaryQuestion);
      if (targetOption) break;
      await sleep(120);
    }

    if (!targetOption) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      out.push({
        selector: item.selector,
        fieldType: "custom_dropdown",
        canonicalKey: key,
        label: item.label,
        signals: [labelText],
        action: "skipped_select_no_match",
        before,
        attemptedValue: value,
        after: getDropdownDisplayValue(trigger),
        verified: false,
        reason: militaryQuestion
          ? "No military NO option matched in dropdown"
          : "No dropdown option matched target value",
      });
      continue;
    }

    targetOption.click();
    targetOption.dispatchEvent(new Event("input", { bubbles: true }));
    targetOption.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(120);
    const after = getDropdownDisplayValue(trigger);
    const verified = normalizePhase1Value(after).includes(normalizePhase1Value(value)) ||
      normalizePhase1Value(getDropdownOptionText(targetOption)).includes(normalizePhase1Value(value));

    out.push({
      selector: item.selector,
      fieldType: "custom_dropdown",
      canonicalKey: key,
      label: item.label,
      signals: [labelText],
      action: verified ? "filled" : "failed_verify",
      before,
      attemptedValue: value,
      after,
      verified,
      reason: verified
        ? militaryQuestion
          ? "Military policy: selected NO dropdown option"
          : "Selected matching dropdown option"
        : "Dropdown selection could not be verified",
    });
  }

  return out;
}

export async function runUnifiedAutofill(
  profile: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
    country?: string | null;
    linkedin_url?: string | null;
    portfolio_url?: string | null;
    work_authorization?: string | null;
    sponsorship_needed?: boolean | null;
  },
  root: Document | ShadowRoot = document
): Promise<UnifiedAutofillRunResult> {
  const phase1 = runPhase1Fill(profile, root);
  const handledBinaryKeys = new Set<"work_authorization" | "sponsorship_needed">(
    phase1.results
      .filter(
        (row) =>
          row.action === "filled" &&
          (row.canonicalKey === "work_authorization" || row.canonicalKey === "sponsorship_needed")
      )
      .map((row) => row.canonicalKey as "work_authorization" | "sponsorship_needed")
  );

  const radioResults = fillKnownRadioGroups(profile, root, handledBinaryKeys);
  const checkboxResults = fillKnownCheckboxes(profile, root, handledBinaryKeys);
  const dropdownResults = await fillCustomDropdowns(profile, root);
  const results = [...phase1.results, ...radioResults, ...checkboxResults, ...dropdownResults];

  return {
    candidates: phase1.candidates,
    results,
    phase1Results: phase1.results,
    radioResults,
    checkboxResults,
    dropdownResults,
  };
}

function collectUploadSignals(
  el: HTMLInputElement,
  root: Document | ShadowRoot = document
): string[] {
  const context = new Set<string>(getBasicSignals(el));
  const addText = (value: string | null | undefined) => {
    const text = normalizeUploadText(value);
    if (text) context.add(text);
  };

  if (el.id) {
    try {
      const explicitLabel =
        root.querySelector(`label[for="${safeCssEscape(el.id)}"]`) ??
        document.querySelector(`label[for="${safeCssEscape(el.id)}"]`);
      addText(explicitLabel?.textContent);
    } catch {
      const explicitLabel = document.querySelector(`label[for="${el.id.replace(/"/g, '\\"')}"]`);
      addText(explicitLabel?.textContent);
    }
  }

  addText(el.closest("label")?.textContent);

  let container: Element | null = el.parentElement;
  for (let depth = 0; depth < 4 && container; depth += 1) {
    addText(container.textContent?.slice(0, 300));
    const triggerCandidates = Array.from(container.querySelectorAll<HTMLElement>(UPLOAD_TRIGGER_SELECTOR))
      .filter((candidate) => candidate !== el && isVisibleElement(candidate))
      .map((candidate) => normalizeUploadText(candidate.textContent))
      .filter((text): text is string => !!text && UPLOAD_TRIGGER_TEXT_PATTERN.test(text));
    triggerCandidates.forEach((text) => addText(text));
    container = container.parentElement;
  }

  return Array.from(context);
}

function classifyUploadSubtype(signals: string[]): UploadDetectorSubType {
  const combined = signals.join(" ").toLowerCase();
  if (/cover.?letter/.test(combined)) return "cover_letter";
  if (/resume|cv|curriculum/.test(combined)) return "resume";
  return "generic";
}

function toScannedUploadFileInput(
  el: HTMLInputElement,
  root: Document | ShadowRoot = document
): ScannedUploadFileInput {
  const signals = collectUploadSignals(el, root);
  const label = signals.find((signal) => /resume|cv|curriculum|cover.?letter|upload|attach/i.test(signal)) ??
    getAssociatedLabelText(el) ??
    getLabelTextForElement(el) ??
    el.name ??
    el.id ??
    "(file input)";
  return {
    selector: getElementSelector(el),
    id: el.id || null,
    name: el.name || null,
    label,
    visible: isVisibleElement(el),
    hasFiles: !!(el.files && el.files.length > 0),
    accept: el.getAttribute("accept"),
    signals,
  };
}

export function scanUploadDetectors(root: Document | ShadowRoot = document): UploadDetectorRunResult {
  const fileInputs = deepQueryAll(root, 'input[type="file"]')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);

  const scannedFileInputs = fileInputs.map((el) => toScannedUploadFileInput(el, root));
  const visibleFileInputs = scannedFileInputs.filter((item) => item.visible);
  const hiddenFileInputs = scannedFileInputs.filter((item) => !item.visible);

  const visibleUploadTriggers = deepQueryAll(root, UPLOAD_TRIGGER_SELECTOR)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => isVisibleElement(el))
    .map((el) => {
      const text = normalizeUploadText(el.textContent) ?? "";
      return {
        selector: getElementSelector(el),
        tag: el.tagName.toLowerCase(),
        text,
        source: "visible_trigger" as const,
      };
    })
    .filter((item) => item.text.length > 0 && item.text.length <= 160 && UPLOAD_TRIGGER_TEXT_PATTERN.test(item.text));

  const candidatesByKey = new Map<string, UploadDetectorCandidate>();
  for (const item of scannedFileInputs) {
    const triggerTexts = item.signals.filter((signal) => UPLOAD_TRIGGER_TEXT_PATTERN.test(signal));
    const hasVisibleTriggerContext = item.visible || triggerTexts.length > 0;
    if (!hasVisibleTriggerContext) continue;
    const subType = classifyUploadSubtype(item.signals);
    const source = item.visible ? "visible_file_input" : "hidden_file_input_with_trigger";
    const key = `${item.selector}::${subType}`;
    if (candidatesByKey.has(key)) continue;
    candidatesByKey.set(key, {
      selector: item.selector,
      label: item.label,
      subType,
      source,
      triggerTexts,
      signals: item.signals,
    });
  }

  if (candidatesByKey.size === 0) {
    for (const trigger of visibleUploadTriggers) {
      const signals = [trigger.text];
      const subType = classifyUploadSubtype(signals);
      const key = `${trigger.selector}::${subType}`;
      if (candidatesByKey.has(key)) continue;
      candidatesByKey.set(key, {
        selector: trigger.selector,
        label: trigger.text,
        subType,
        source: "trigger_only",
        triggerTexts: [trigger.text],
        signals,
      });
    }
  }

  return {
    visibleFileInputs,
    hiddenFileInputs,
    visibleUploadTriggers,
    candidates: Array.from(candidatesByKey.values()),
  };
}

export function deepQueryAll(root: Document | ShadowRoot, selector: string): Element[] {
  const results: Element[] = [];
  function walk(currentRoot: Document | ShadowRoot) {
    results.push(...Array.from(currentRoot.querySelectorAll(selector)));
    const all = currentRoot.querySelectorAll("*");
    for (const el of all) {
      if ((el as Element).shadowRoot) walk((el as Element).shadowRoot as ShadowRoot);
    }
  }
  walk(root);
  return results;
}

export function scanRadioGroups(root: Document | ShadowRoot = document): ScannedRadioGroup[] {
  const radioGroupsMap = new Map<string, ScannedRadioOption[]>();
  const radios = deepQueryAll(root, 'input[type="radio"]')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
    .filter((el) => isVisibleElement(el));
  radios.forEach((radio, idx) => {
    const key = radio.name?.trim() || `__unnamed_${idx}`;
    const current = radioGroupsMap.get(key) ?? [];
    current.push({
      selector: getElementSelector(radio),
      id: radio.id || null,
      name: radio.name || null,
      label: getInputChoiceLabel(radio),
      checked: radio.checked,
      disabled: !!radio.disabled,
      value: radio.value ?? "",
    });
    radioGroupsMap.set(key, current);
  });
  return Array.from(radioGroupsMap.entries()).map(([name, options]) => ({ name, options }));
}

export function scanCheckboxes(root: Document | ShadowRoot = document): ScannedCheckbox[] {
  return deepQueryAll(root, 'input[type="checkbox"]')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
    .filter((el) => isVisibleElement(el))
    .map((checkbox) => {
      const label = getInputChoiceLabel(checkbox);
      return {
        selector: getElementSelector(checkbox),
        id: checkbox.id || null,
        name: checkbox.name || null,
        label,
        checked: checkbox.checked,
        disabled: !!checkbox.disabled,
        classification: classifyCheckboxLabel(label),
      };
    });
}

export function scanDropdowns(root: Document | ShadowRoot = document): ScannedDropdown[] {
  const deduped = new Map<string, ScannedDropdown>();
  const candidates = deepQueryAll(root, DROPDOWN_SELECTOR)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => isVisibleElement(el));
  candidates.forEach((el) => {
    const selector = getElementSelector(el);
    if (deduped.has(selector)) return;
    let pattern = "unknown";
    if (el.matches('[role="combobox"]')) pattern = "aria-combobox";
    else if (el.matches('[aria-haspopup="listbox"]')) pattern = "aria-haspopup-listbox";
    else if (el.className.includes("Mui")) pattern = "mui";
    else if (el.className.includes("ant-select")) pattern = "ant-select";
    else if (el.className.includes("react-select") || el.className.includes("select__control")) pattern = "react-select";
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 120) || "(dropdown)";
    deduped.set(selector, { selector, label, pattern, expanded: el.getAttribute("aria-expanded") });
  });
  return Array.from(deduped.values());
}

export function testRadioGroupsByNames(groupNames: string[], root: Document | ShadowRoot = document): {
  diagnostics: RadioTestDiagnostics;
  items: RadioTestItemResult[];
} {
  const allRadios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
  const perNameCounts: Record<string, number> = {};

  console.log("[RADIO TEST] received names:", groupNames);
  console.log("[RADIO TEST] total radios in frame:", allRadios.length);

  const items = groupNames.map((name) => {
    let candidates = allRadios.filter((r) => (r.getAttribute("name") ?? "") === name);
    perNameCounts[name] = candidates.length;
    console.log(`[RADIO TEST] name="${name}" selector matches=${candidates.length}`);

    if (candidates.length === 0) {
      const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      candidates = allRadios.filter((r) => {
        const label = getInputChoiceLabel(r).toLowerCase();
        const value = (r.value ?? "").toLowerCase();
        return tokens.some((t) => label.includes(t) || value.includes(t));
      });
    }

    if (candidates.length === 0) {
      return {
        groupName: name,
        before: "(none found)",
        action: "none",
        after: "(none found)",
        success: false,
        detail: "No DOM radios found for this group name",
      };
    }

    const groupText = `${name} ${candidates.map((r) => getInputChoiceLabel(r)).join(" | ")}`;
    if (isEeocLike(groupText)) {
      const current = candidates.filter((r) => r.checked).map((r) => getInputChoiceLabel(r)).join(" | ") || "(none)";
      return {
        groupName: name,
        before: current,
        action: "skipped_eeoc",
        after: current,
        success: true,
        detail: "Detected EEO/DEI field and skipped",
      };
    }

    const before = candidates.filter((r) => r.checked).map((r) => getInputChoiceLabel(r)).join(" | ") || "(none)";
    const target = candidates.find((r) => !r.checked && !r.disabled) ?? null;
    if (!target) {
      return {
        groupName: name,
        before,
        action: "skip",
        after: before,
        success: true,
        detail: "No unchecked enabled option",
      };
    }

    if (checkedSetter) checkedSetter.call(target, true);
    else target.checked = true;
    target.dispatchEvent(new Event("click", { bubbles: true }));
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    const after = candidates.filter((r) => r.checked).map((r) => getInputChoiceLabel(r)).join(" | ") || "(none)";

    return {
      groupName: name,
      before,
      action: `selected "${getInputChoiceLabel(target)}"`,
      after,
      success: !!target.checked,
      detail: target.checked ? "Selection applied" : "Selection did not stick",
    };
  });

  if (items.length === 0 && groupNames.length > 0) {
    console.warn("[RADIO TEST] No radio items processed despite received names");
  }

  return {
    diagnostics: {
      receivedCount: groupNames.length,
      domTotalRadios: allRadios.length,
      perNameCounts,
    },
    items,
  };
}

export function testCheckboxesByDescriptors(
  descriptors: CheckboxDescriptor[],
  root: Document | ShadowRoot = document
): {
  diagnostics: CheckboxTestDiagnostics;
  items: CheckboxTestItemResult[];
} {
  const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
  const allCheckboxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const perIdCounts: Record<string, number> = {};

  console.log("[CHECKBOX TEST] received descriptors:", descriptors);
  console.log("[CHECKBOX TEST] received ids:", descriptors.map((d) => d.id).filter(Boolean));
  console.log("[CHECKBOX TEST] total checkboxes in frame:", allCheckboxes.length);

  const items = descriptors.map((descriptor) => {
    const idKey = descriptor.id ?? descriptor.selector;
    let exactMatches: HTMLInputElement[] = [];
    if (descriptor.id) {
      const byId = document.getElementById(descriptor.id);
      if (byId instanceof HTMLInputElement && byId.type === "checkbox") exactMatches.push(byId);
      try {
        const byAttr = root.querySelector(`input[type="checkbox"][id="${safeCssEscape(descriptor.id)}"]`);
        if (byAttr instanceof HTMLInputElement) exactMatches.push(byAttr);
      } catch {
        const safeAttr = descriptor.id.replace(/"/g, '\\"');
        const byAttr = root.querySelector(`input[type="checkbox"][id="${safeAttr}"]`);
        if (byAttr instanceof HTMLInputElement) exactMatches.push(byAttr);
      }
    }
    perIdCounts[idKey] = exactMatches.length;
    console.log(`[CHECKBOX TEST] idOrSelector="${idKey}" exact matches=${exactMatches.length}`);

    let el = exactMatches.find(Boolean) ?? null;
    if (!el && descriptor.selector) {
      try {
        const bySelector = root.querySelector(descriptor.selector);
        if (bySelector instanceof HTMLInputElement && bySelector.type === "checkbox") el = bySelector;
      } catch {
        // ignore invalid selector
      }
    }
    if (!el && descriptor.label) {
      const tokens = descriptor.label.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      el = allCheckboxes.find((checkbox) => {
        const text = getInputChoiceLabel(checkbox).toLowerCase();
        return tokens.some((t) => text.includes(t));
      }) ?? null;
    }
    if (!el) {
      return {
        selector: descriptor.selector,
        label: descriptor.label,
        classification: descriptor.classification,
        before: false,
        action: "none",
        after: false,
        success: false,
        detail: "No checkbox found by id/selector/fallback",
      };
    }

    const effectiveLabel = `${descriptor.label} ${getInputChoiceLabel(el)}`;
    if (isEeocLike(effectiveLabel)) {
      return {
        selector: descriptor.selector,
        label: descriptor.label,
        classification: descriptor.classification,
        before: el.checked,
        action: "skipped_eeoc",
        after: el.checked,
        success: true,
        detail: "Detected EEO/DEI field and skipped",
      };
    }
    if (el.disabled) {
      return {
        selector: descriptor.selector,
        label: descriptor.label,
        classification: descriptor.classification,
        before: el.checked,
        action: "skip",
        after: el.checked,
        success: true,
        detail: "Checkbox is disabled",
      };
    }

    const before = el.checked;
    const next = !before;
    if (checkedSetter) checkedSetter.call(el, next);
    else el.checked = next;
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const after = el.checked;
    return {
      selector: descriptor.selector,
      label: descriptor.label,
      classification: descriptor.classification,
      before,
      action: `toggle ${before} -> ${next}`,
      after,
      success: after === next,
      detail: after === next ? "Toggle applied" : "Toggle did not stick",
    };
  });

  if (items.length === 0 && descriptors.length > 0) {
    console.warn("[CHECKBOX TEST] No checkbox items processed despite received descriptors");
  }

  return {
    diagnostics: {
      receivedCount: descriptors.length,
      domTotalCheckboxes: allCheckboxes.length,
      perIdCounts,
    },
    items,
  };
}

export async function testDropdownsByDescriptors(
  descriptors: DropdownDescriptor[],
  root: Document | ShadowRoot = document
): Promise<DropdownTestItemResult[]> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const items: DropdownTestItemResult[] = [];
  for (const descriptor of descriptors) {
    const el = root.querySelector(descriptor.selector) as HTMLElement | null;
    if (!el) {
      items.push({
        selector: descriptor.selector,
        label: descriptor.label,
        pattern: descriptor.pattern,
        beforeExpanded: null,
        action: "skip",
        afterExpanded: null,
        optionsFound: 0,
        success: false,
        detail: "Trigger not found",
      });
      continue;
    }
    const beforeExpanded = el.getAttribute("aria-expanded");
    el.click();
    await sleep(180);
    const options = Array.from(root.querySelectorAll('[role="option"]'))
      .map((o) => o.textContent?.trim() ?? "")
      .filter((t) => t.length > 0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(80);
    const afterExpanded = el.getAttribute("aria-expanded");
    items.push({
      selector: descriptor.selector,
      label: descriptor.label,
      pattern: descriptor.pattern,
      beforeExpanded,
      action: "open -> read options -> escape",
      afterExpanded,
      optionsFound: options.length,
      success: options.length > 0,
      detail: options.length > 0 ? `Read ${options.length} options` : "No [role=option] nodes found",
    });
  }
  return items;
}
