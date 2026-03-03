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
  | "portfolio_url";

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

const AGREEMENT_PATTERN = /agree|consent|acknowledge|accept|terms|privacy|authorized/i;
const EEOC_PATTERN = /gender|race|ethnic|ethnicity|sexual|orientation|veteran|disability|eeo/i;
const SENSITIVE_PHASE1_PATTERN =
  /gender|race|ethnic|ethnicity|sexual|orientation|veteran|disability|eeo|work authorization|authorized to work|visa|sponsorship|self identify/i;
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
  city: [/^city$/i, /city.?name/i, /town/i],
  state: [/^state$/i, /province/i, /region/i],
  zip_code: [/zip/i, /postal/i, /post.?code/i],
  country: [/country/i, /nation/i],
  linkedin_url: [/linkedin/i, /linked.?in/i],
  portfolio_url: [/portfolio/i, /website/i, /personal.?site/i, /\bblog\b/i],
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
  const name = el.getAttribute("name");
  if (name) return `${tag}[name="${safeCssEscape(name)}"]`;
  const dataQa = el.getAttribute("data-qa");
  if (dataQa) return `${tag}[data-qa="${safeCssEscape(dataQa)}"]`;
  const dataAutomationId = el.getAttribute("data-automation-id");
  if (dataAutomationId) return `${tag}[data-automation-id="${safeCssEscape(dataAutomationId)}"]`;
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`));
  const index = siblings.indexOf(el);
  return index >= 0 ? `${parent.tagName.toLowerCase()} > ${tag}:nth-of-type(${index + 1})` : tag;
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
  const elements = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select'
    )
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
  },
  root: Document | ShadowRoot = document
): Phase1RunResult {
  const candidates = scanPhase1Candidates(root);
  const results: Phase1FillResult[] = candidates.map((candidate) => {
    const match = matchPhase1Field(candidate, profile);
    const baseResult: Omit<Phase1FillResult, "action" | "after" | "verified" | "reason"> = {
      selector: candidate.selector,
      fieldType: candidate.inputType,
      canonicalKey: match.matchedKey,
      label: candidate.label,
      signals: candidate.signals,
      before: candidate.currentValue,
      attemptedValue: match.profileValue,
    };

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
    try {
      const found = root.querySelector(candidate.selector);
      if (
        found instanceof HTMLInputElement ||
        found instanceof HTMLTextAreaElement ||
        found instanceof HTMLSelectElement
      ) {
        element = found;
      }
    } catch {
      element = null;
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

  return { candidates, results };
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
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((el) => isVisibleElement(el));
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
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
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
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(DROPDOWN_SELECTOR)).filter((el) => isVisibleElement(el));
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
