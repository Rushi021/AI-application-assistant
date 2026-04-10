import { MSG, STORAGE_KEYS } from "@/shared/constants";
import type {
  AutofillProgress,
  FileUploadBlockerDecision,
  FileUploadBlockerSubType,
  FormBlocker,
} from "@/shared/types";

type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type AutofillAnswerMap = Record<string, string>;

type ScannedField = {
  element: FillableElement;
  identifiers: string[];
};

type FieldMatch = {
  element: FillableElement;
  answerValue: string;
  answerKey?: string;
};

type UploadDecisionEntry = {
  decision: FileUploadBlockerDecision;
  ts: number;
};

type UploadDecisionMap = Record<string, UploadDecisionEntry>;

let filledElements = new WeakSet<Element>();
let observerStarted = false;
let autofillActivated = false;
let blockedOnUpload = false;
let pipelineRunCount = 0;
const MAX_PIPELINE_RUNS_PER_ACTIVATION = 5;
let autofillRunning = false;
let debounceTimer: number | null = null;
let lastBlockedKey: string | null = null;
let lastProgressSignature: string | null = null;
/** After extension reload, the old content script cannot use chrome.* — only a full page refresh fixes it. */
let extensionContextDead = false;
let extensionInvalidatedBannerShown = false;

const UPLOAD_DECISION_TTL_MS = 20 * 60 * 1000;

function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function showExtensionInvalidatedBannerOnce(): void {
  if (extensionInvalidatedBannerShown || !document.documentElement) return;
  extensionInvalidatedBannerShown = true;
  const bar = document.createElement("div");
  bar.setAttribute("data-ai-job-assistant", "extension-reload-notice");
  bar.textContent =
    "AI Job Assistant: this tab is using an old extension session. Refresh the page (F5) to use autofill again.";
  bar.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483646",
    "padding:10px 16px",
    "font:13px/1.4 system-ui,sans-serif",
    "background:#1e1e1e",
    "color:#f5f5f5",
    "text-align:center",
    "box-shadow:0 2px 8px rgba(0,0,0,.35)",
    "border-bottom:1px solid #f97316",
  ].join(";");
  document.documentElement.appendChild(bar);
}

/** Pairs that must NEVER match despite substring overlap (both sides match normalizeText() output). */
const BLOCKED_MATCH_PAIRS: ReadonlySet<string> = new Set([
  "address line 1|address line 2",
  "address line 1|postal code",
  "address line 1|zip code",
  "address line 2|address line 1",
  "address line 2|postal code",
  "address line 2|zip code",
  "city|ethnicity",
  "company name|first name",
  "company name|full name",
  "company name|last name",
  "company name|name",
  "country|country code",
  "country|county",
  "country code|country",
  "county|country",
  "current title|job title",
  "disability status|state",
  "email|female",
  "employer|first name",
  "employer|full name",
  "employer|last name",
  "employer|name",
  "employer name|first name",
  "employer name|full name",
  "employer name|last name",
  "employer name|name",
  "ethnicity|city",
  "first name|company name",
  "first name|employer",
  "first name|employer name",
  "first name|middle name",
  "first name|school name",
  "full name|company name",
  "full name|employer",
  "full name|employer name",
  "full name|middle name",
  "full name|preferred name",
  "full name|school name",
  "job title|current title",
  "job title|title",
  "last name|company name",
  "last name|employer",
  "last name|employer name",
  "last name|middle name",
  "last name|preferred name",
  "last name|school name",
  "middle name|first name",
  "middle name|full name",
  "middle name|last name",
  "middle name|name",
  "name|company name",
  "name|employer",
  "name|employer name",
  "name|middle name",
  "name|phone number",
  "name|school name",
  "phone country|country",
  "phone number|name",
  "phone|sponsorship",
  "postal code|address line 1",
  "postal code|address line 2",
  "preferred name|full name",
  "preferred name|last name",
  "school name|first name",
  "school name|full name",
  "school name|last name",
  "school name|name",
  "state|disability status",
  "state|veteran status",
  "title|job title",
  "veteran status|state",
  "zip code|address line 1",
  "zip code|address line 2",
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ");
}

function isTruthyAnswer(value: string): boolean {
  return /^(yes|true|1|checked|on)$/i.test(value.trim());
}

function isFalsyAnswer(value: string): boolean {
  return /^(no|false|0|unchecked|off)$/i.test(value.trim());
}

function splitAnswerTokens(value: string): string[] {
  return value
    .split(/[,\n;|]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dispatchFieldEvents(element: FillableElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

/** Native <select>: avoid `input` (not standard); React/controlled components expect change/blur. */
function dispatchSelectEvents(element: HTMLSelectElement): void {
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function getLabelByFor(element: FillableElement): string {
  if (!element.id) return "";
  try {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    return label?.textContent?.trim() ?? "";
  } catch {
    const safeId = element.id.replace(/"/g, '\\"');
    const label = document.querySelector(`label[for="${safeId}"]`);
    return label?.textContent?.trim() ?? "";
  }
}

function getAncestorLabel(element: FillableElement): string {
  const label = element.closest("label");
  return label?.textContent?.trim() ?? "";
}

function getLegendText(element: FillableElement): string {
  const fieldset = element.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  return legend?.textContent?.trim() ?? "";
}

function isTextLikeInput(type: string): boolean {
  const normalized = type.toLowerCase();
  return ![
    "hidden",
    "button",
    "submit",
    "reset",
    "checkbox",
    "radio",
    "file",
  ].includes(normalized);
}

function isElementVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (htmlElement.offsetParent !== null) return true;
  return htmlElement.getBoundingClientRect().height > 0;
}

function isEligibleField(element: FillableElement): boolean {
  if (element.disabled) return false;
  if (!isElementVisible(element)) return false;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button") {
      return false;
    }
  }
  return true;
}

function dedupeIdentifiers(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function getParentLabel(element: FillableElement): string {
  return element.parentElement?.querySelector("label")?.textContent?.trim() ?? "";
}

function getBestFieldLabel(element: FillableElement): string {
  return (
    getLabelByFor(element) ||
    getAncestorLabel(element) ||
    getParentLabel(element) ||
    getPreviousSiblingLabelLikeText(element) ||
    element.getAttribute("aria-label") ||
    element.getAttribute("placeholder") ||
    element.name ||
    element.id ||
    element.getAttribute("autocomplete") ||
    ""
  ).trim();
}

type FieldResultItem = {
  selector: string;
  label: string;
  action: "filled" | "skipped";
  reason: "filled" | "no_answer_match" | "fill_failed";
  answerKey?: string;
};

function getPreviousSiblingLabelLikeText(element: FillableElement): string {
  const previous = element.previousElementSibling;
  if (!previous) return "";
  const tag = previous.tagName.toLowerCase();
  if (tag !== "label" && tag !== "div") return "";
  return previous.textContent?.trim() ?? "";
}

function collectFieldIdentifiers(element: FillableElement): string[] {
  return dedupeIdentifiers([
    element.name ?? "",
    element.id ?? "",
    element.getAttribute("placeholder") ?? "",
    element.getAttribute("aria-label") ?? "",
    getLabelByFor(element),
    getAncestorLabel(element),
    getParentLabel(element),
    getPreviousSiblingLabelLikeText(element),
    element.getAttribute("autocomplete") ?? "",
    getLegendText(element),
  ]);
}

function collectFillableElements(): FillableElement[] {
  const found = new Set<FillableElement>();

  const visitRoot = (root: ParentNode): void => {
    const controls = root.querySelectorAll("input, select, textarea");
    controls.forEach((node) => {
      if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
        found.add(node as FillableElement);
      }
    });

    const allNodes = root.querySelectorAll("*");
    allNodes.forEach((node) => {
      if (node instanceof Element && node.shadowRoot) {
        visitRoot(node.shadowRoot);
      }
    });
  };

  visitRoot(document);
  return Array.from(found);
}

function collectFileInputs(): HTMLInputElement[] {
  const found = new Set<HTMLInputElement>();

  const visitRoot = (root: ParentNode): void => {
    const inputs = root.querySelectorAll("input[type='file']");
    inputs.forEach((node) => {
      if (node instanceof HTMLInputElement) {
        found.add(node);
      }
    });

    const allNodes = root.querySelectorAll("*");
    allNodes.forEach((node) => {
      if (node instanceof Element && node.shadowRoot) {
        visitRoot(node.shadowRoot);
      }
    });
  };

  visitRoot(document);
  return Array.from(found);
}

function cssEscapeSafe(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/[^a-zA-Z0-9_\-]/g, "_");
  }
}

function buildElementSelector(element: Element): string {
  if (element.id) {
    return `#${cssEscapeSafe(element.id)}`;
  }
  if (element instanceof HTMLInputElement && element.type === "file" && element.name) {
    return `input[type="file"][name="${cssEscapeSafe(element.name)}"]`;
  }

  const segments: string[] = [];
  let current: Element | null = element;
  let guard = 0;
  while (current && current !== document.body && guard < 6) {
    const tag = current.tagName.toLowerCase();
    let segment = tag;
    if (current.id) {
      segment += `#${cssEscapeSafe(current.id)}`;
      segments.unshift(segment);
      break;
    }
    const currentTagName = current.tagName;
    const parentEl: HTMLElement | null = current.parentElement;
    if (parentEl) {
      const sameTagSiblings = Array.from(parentEl.children).filter(
        (node: Element) => node.tagName === currentTagName
      );
      if (sameTagSiblings.length > 1) {
        const idx = sameTagSiblings.indexOf(current) + 1;
        segment += `:nth-of-type(${idx})`;
      }
    }
    segments.unshift(segment);
    current = parentEl;
    guard += 1;
  }
  return segments.join(" > ");
}

function getFileInputSignals(input: HTMLInputElement): string[] {
  const explicitLabels = input.labels
    ? Array.from(input.labels).map((label) => label.textContent?.trim() ?? "")
    : [];
  const byFor = getLabelByFor(input);
  const ancestorLabel = getAncestorLabel(input);
  const legend = getLegendText(input);
  const closestHeading = input
    .closest("section, form, div, article")
    ?.querySelector("h1, h2, h3, h4, [role='heading']")
    ?.textContent
    ?.trim() ?? "";
  const parentText = input.parentElement?.textContent?.trim().slice(0, 220) ?? "";

  return dedupeIdentifiers([
    input.name ?? "",
    input.id ?? "",
    input.getAttribute("aria-label") ?? "",
    input.getAttribute("placeholder") ?? "",
    input.getAttribute("accept") ?? "",
    byFor,
    ancestorLabel,
    legend,
    closestHeading,
    parentText,
    ...explicitLabels,
  ]);
}

function classifyUploadSubType(signals: string[]): FileUploadBlockerSubType {
  const combined = signals.join(" ").toLowerCase();
  if (/cover.?letter/.test(combined)) return "cover_letter";
  if (/resume|cv|curriculum/.test(combined)) return "resume";
  return "generic";
}

function toBlockerDecisionKey(selector: string, subType: FileUploadBlockerSubType | string): string {
  return `${selector}::${subType || "generic"}`;
}

function progressSignature(progress: AutofillProgress): string {
  const blocker = progress.activeBlocker;
  return JSON.stringify({
    state: progress.state,
    total: progress.total,
    filled: progress.filled,
    skipped: progress.skipped,
    manual: progress.manual,
    paused: progress.paused,
    completed: progress.completed,
    blocker: blocker ? `${blocker.type}:${blocker.selector}:${blocker.subType ?? ""}` : "",
  });
}

function emitAutofillProgress(progress: AutofillProgress): void {
  const signature = progressSignature(progress);
  if (signature === lastProgressSignature) return;
  lastProgressSignature = signature;
  chrome.runtime.sendMessage({ type: MSG.AUTOFILL_PROGRESS, data: progress }).catch(() => {});
  chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_PROGRESS]: progress }).catch(() => {});
}

function buildProgress({
  state,
  total,
  filled,
  skipped = 0,
  paused = false,
  completed = false,
  activeBlocker = null,
}: {
  state: AutofillProgress["state"];
  total: number;
  filled: number;
  skipped?: number;
  paused?: boolean;
  completed?: boolean;
  activeBlocker?: FormBlocker | null;
}): AutofillProgress {
  return {
    state,
    total,
    filled,
    manual: 0,
    skipped,
    currentField: null,
    currentAction: null,
    paused,
    completed,
    sessionComplete: completed,
    stepIndex: 0,
    fields: [],
    activeBlocker,
    validationErrors: [],
    lastFilledField: null,
  };
}

type ScanStats = {
  totalControls: number;
  totalInputs: number;
  totalTextareas: number;
  totalSelects: number;
  fileInputs: number;
  eligibleControls: number;
};

function scanFormFields(nodes: FillableElement[] = collectFillableElements()): ScannedField[] {
  const fields: ScannedField[] = [];

  for (const node of nodes) {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement)) {
      continue;
    }

    const element = node as FillableElement;
    if (!isEligibleField(element)) continue;

    const identifiers = collectFieldIdentifiers(element);

    if (identifiers.length === 0) continue;
    fields.push({ element, identifiers });
  }

  return fields;
}

function computeScanStats(nodes: FillableElement[]): ScanStats {
  let totalInputs = 0;
  let totalTextareas = 0;
  let totalSelects = 0;
  let fileInputs = 0;
  let eligibleControls = 0;

  for (const element of nodes) {
    if (element instanceof HTMLInputElement) {
      totalInputs += 1;
      if (element.type.toLowerCase() === "file") fileInputs += 1;
    } else if (element instanceof HTMLTextAreaElement) {
      totalTextareas += 1;
    } else if (element instanceof HTMLSelectElement) {
      totalSelects += 1;
    }

    if (isEligibleField(element)) {
      eligibleControls += 1;
    }
  }

  return {
    totalControls: nodes.length,
    totalInputs,
    totalTextareas,
    totalSelects,
    fileInputs,
    eligibleControls,
  };
}

type EducationFieldType = "university" | "degree" | "field_of_study" | "gpa";

type EducationEntryAnswers = Partial<Record<EducationFieldType, string>>;

function classifyEducationField(identifiers: string[]): EducationFieldType | null {
  const tokens = identifiers.map(normalizeText);

  const has = (pattern: RegExp): boolean => tokens.some((token) => pattern.test(token));
  if (has(/\bgpa\b|\bcgpa\b|grade point|overall result/)) return "gpa";
  if (has(/field of study|\bmajor\b|\bspecialization\b|\bconcentration\b/)) return "field_of_study";
  if (has(/\bdegree\b/)) return "degree";
  if (has(/\bschool\b|\buniversity\b|\bcollege\b|\binstitute\b|\binstitution\b/)) return "university";
  return null;
}

function getFieldCurrentValue(element: FillableElement): string {
  if (element instanceof HTMLSelectElement) {
    const selectedText = element.selectedOptions[0]?.textContent?.trim() ?? "";
    const raw = selectedText || element.value || "";
    if (/^select(\s+one)?$/i.test(raw.trim())) return "";
    return raw.trim();
  }
  return element.value.trim();
}

function collectFillableElementsInside(container: Element): FillableElement[] {
  return Array.from(container.querySelectorAll("input, select, textarea")).filter(
    (node): node is FillableElement =>
      node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
  );
}

function findEducationGroupContainer(element: FillableElement): HTMLElement | null {
  let current = element.parentElement;
  let fallback: HTMLElement | null = null;

  while (current && current !== document.body) {
    const controls = collectFillableElementsInside(current);
    if (controls.length >= 2) {
      const educationControls = controls.filter((control) =>
        Boolean(classifyEducationField(collectFieldIdentifiers(control)))
      );
      if (educationControls.length >= 2 && educationControls.length <= 6) {
        return current;
      }
      if (!fallback && educationControls.length >= 2) {
        fallback = current;
      }
    }
    current = current.parentElement;
  }

  return fallback;
}

function extractEducationEntries(answers: AutofillAnswerMap): EducationEntryAnswers[] {
  const byIndex = new Map<number, EducationEntryAnswers>();
  const keyRegex = /^education_history_(\d+)_(university|degree|field_of_study|gpa)$/;

  for (const [key, value] of Object.entries(answers)) {
    const match = keyRegex.exec(key.trim().toLowerCase());
    if (!match) continue;
    const index = Number.parseInt(match[1], 10);
    const field = match[2] as EducationFieldType;
    if (!Number.isFinite(index) || index <= 0) continue;
    const normalizedValue = value.trim();
    if (!normalizedValue) continue;
    const existing = byIndex.get(index) ?? {};
    existing[field] = normalizedValue;
    byIndex.set(index, existing);
  }

  return Array.from(byIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value);
}

function findEducationEntryByUniversity(
  entries: EducationEntryAnswers[],
  universityValue: string
): EducationEntryAnswers | null {
  const query = normalizeText(universityValue);
  if (!query) return null;
  for (const entry of entries) {
    const candidate = normalizeText(entry.university ?? "");
    if (!candidate) continue;
    if (candidate.includes(query) || query.includes(candidate)) {
      return entry;
    }
  }
  return null;
}

function isStrongMatch(identifier: string, answerKey: string): boolean {
  if (identifier === answerKey) return true;

  const idTokens = identifier.split(/[_\s]+/).filter((t) => t.length > 0);
  const keyTokens = answerKey.split(/[_\s]+/).filter((t) => t.length > 0);

  if (idTokens.length === 1 && idTokens[0].length <= 6) {
    return keyTokens.includes(idTokens[0]) || answerKey === identifier;
  }
  if (keyTokens.length === 1 && keyTokens[0].length <= 6) {
    return idTokens.includes(keyTokens[0]) || answerKey === identifier;
  }

  const shorter = idTokens.length <= keyTokens.length ? idTokens : keyTokens;
  const longer = idTokens.length <= keyTokens.length ? keyTokens : idTokens;

  const allTokensFound = shorter.every((st) =>
    longer.some((lt) => lt === st || lt.startsWith(st) || st.startsWith(lt))
  );

  if (!allTokensFound) return false;

  const matchCount = shorter.filter((st) =>
    longer.some((lt) => lt === st || lt.startsWith(st) || st.startsWith(lt))
  ).length;

  return matchCount / Math.max(shorter.length, 1) >= 0.5;
}

function findUniversityValueInContainer(
  container: HTMLElement,
  identifiersCache: Map<FillableElement, string[]>
): string {
  for (const control of collectFillableElementsInside(container)) {
    const identifiers = identifiersCache.get(control) ?? collectFieldIdentifiers(control);
    identifiersCache.set(control, identifiers);
    const fieldType = classifyEducationField(identifiers);
    if (fieldType !== "university") continue;
    const currentValue = getFieldCurrentValue(control);
    if (currentValue) return currentValue;
  }
  return "";
}

function matchFieldsToAnswers(fields: ScannedField[], answers: AutofillAnswerMap): FieldMatch[] {
  const answerEntries = Object.entries(answers)
    .map(([key, value]) => ({
      key,
      keyNorm: normalizeText(key),
      value,
    }))
    .filter((entry) => entry.keyNorm.length > 1 && entry.value.trim().length > 0);

  const educationEntries = extractEducationEntries(answers);
  const identifiersCache = new Map<FillableElement, string[]>();
  for (const field of fields) {
    identifiersCache.set(field.element, field.identifiers);
  }

  const educationContainerOrder = new Map<HTMLElement, number>();
  if (educationEntries.length > 0) {
    for (const field of fields) {
      const fieldType = classifyEducationField(field.identifiers);
      if (!fieldType) continue;
      const container = findEducationGroupContainer(field.element);
      if (!container || educationContainerOrder.has(container)) continue;
      educationContainerOrder.set(container, educationContainerOrder.size);
    }
  }

  const matches: FieldMatch[] = [];

  for (const field of fields) {
    const educationFieldType = classifyEducationField(field.identifiers);
    if (educationFieldType && educationEntries.length > 0) {
      const container = findEducationGroupContainer(field.element);
      if (container) {
        const scopedIndex = educationContainerOrder.get(container);
        const scopedEntry = scopedIndex != null ? educationEntries[scopedIndex] : null;
        const universityInGroup = findUniversityValueInContainer(container, identifiersCache);
        const schoolMatchedEntry =
          universityInGroup
            ? findEducationEntryByUniversity(educationEntries, universityInGroup)
            : null;
        const educationValue =
          schoolMatchedEntry?.[educationFieldType] ??
          scopedEntry?.[educationFieldType] ??
          null;
        if (educationValue && educationValue.trim()) {
          matches.push({ element: field.element, answerValue: educationValue, answerKey: `education_history:${educationFieldType}` });
          continue;
        }
      }
    }

    let best: { score: number; answerValue: string; answerKey: string } | null = null;
    const normalizedIdentifiers = field.identifiers.map(normalizeText).filter((id) => id.length > 1);

    for (const identifier of normalizedIdentifiers) {
      for (const answerEntry of answerEntries) {
        const pairKey = `${identifier}|${answerEntry.keyNorm}`;
        if (BLOCKED_MATCH_PAIRS.has(pairKey)) continue;

        const isMatch = isStrongMatch(identifier, answerEntry.keyNorm);
        if (!isMatch) continue;

        let score = 0;
        if (identifier === answerEntry.keyNorm) {
          score = 1000;
        } else {
          const idTokens = identifier.split(/[_\s]+/).filter((t) => t.length > 0);
          const keyTokens = answerEntry.keyNorm.split(/[_\s]+/).filter((t) => t.length > 0);
          const matchingTokens = idTokens.filter((t) => keyTokens.includes(t)).length;
          score = matchingTokens * 100 + Math.min(identifier.length, answerEntry.keyNorm.length);
        }
        if (!best || score > best.score) {
          best = { score, answerValue: answerEntry.value, answerKey: answerEntry.key };
        }
      }
    }

    if (best) {
      console.log("[MATCH]", {
        fieldIdentifiers: normalizedIdentifiers.slice(0, 3),
        matchedKey: best.answerKey,
        matchedValue: (best.answerValue ?? "").substring(0, 30),
        score: best.score,
      });
      matches.push({ element: field.element, answerValue: best.answerValue, answerKey: best.answerKey });
    } else {
      console.log("[MATCH-SKIP]", {
        fieldIdentifiers: normalizedIdentifiers.slice(0, 3),
        reason: "no match found",
      });
    }
  }

  return matches;
}

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

const US_STATE_NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_ABBR_TO_NAME).map(([abbr, name]) => [normalizeText(name), abbr.toLowerCase()])
);

function compactToken(value: string): string {
  return value.replace(/\s+/g, "");
}

function alnumToken(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function acronymToken(value: string): string {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("");
}

function normalizeToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/'s$/g, "")
    .replace(/s$/g, "");
}

function phraseTokens(value: string): string[] {
  const ignored = new Set(["of", "the", "and", "in", "to", "for", "on", "a", "an"]);
  return normalizeText(value)
    .split(" ")
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function tokenOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let overlap = 0;
  for (const token of a) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.length, b.length);
}

function getFieldLabel(element: HTMLElement): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  const id = element.id;
  if (id) {
    try {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
      if (label) return label.textContent?.trim() ?? "";
    } catch {
      const safeId = id.replace(/"/g, '\\"');
      const label = document.querySelector<HTMLLabelElement>(`label[for="${safeId}"]`);
      if (label) return label.textContent?.trim() ?? "";
    }
  }

  const parentLabel = element.closest("label");
  if (parentLabel) return parentLabel.textContent?.trim() ?? "";

  const prev = element.previousElementSibling;
  if (prev?.tagName === "LABEL") return prev.textContent?.trim() ?? "";

  const legend = element.closest("fieldset")?.querySelector("legend");
  if (legend) return legend.textContent?.trim() ?? "";

  return "";
}

/**
 * For select/dropdown fields with Yes/No options, interpret the stored answer
 * based on the question context rather than trying to substring-match the raw value.
 */
function interpretAnswerForYesNoSelect(
  answerValue: string,
  answerKey: string,
  options: string[]
): string | null {
  const normalizedOptions = options.map((o) => normalizeText(o));
  const isYesNo = normalizedOptions.some((o) => o === "yes") && normalizedOptions.some((o) => o === "no");

  if (!isYesNo) return null;

  const norm = normalizeText(answerValue);

  const YES_SIGNALS = ["yes", "true", "1", "y"];
  const NO_SIGNALS = ["no", "false", "0", "n", "none", "n_a", "na"];

  if (YES_SIGNALS.includes(norm)) return "Yes";
  if (NO_SIGNALS.includes(norm)) return "No";

  const keyNorm = normalizeText(answerKey);

  if (
    keyNorm.includes("authorized") ||
    keyNorm.includes("authorization") ||
    keyNorm.includes("eligible") ||
    keyNorm.includes("right_to_work") ||
    keyNorm.includes("legally_authorized")
  ) {
    const authorizedValues = [
      "us_citizen",
      "citizen",
      "permanent_resident",
      "green_card",
      "authorized",
      "h1b",
      "h4_ead",
      "ead",
      "opt",
      "cpt",
      "work_visa",
      "tn_visa",
      "l1",
      "o1",
      "e2",
    ];
    if (authorizedValues.some((v) => norm.includes(v)) || norm.includes("yes")) {
      return "Yes";
    }
    if (norm.includes("no") || norm.includes("unauthorized") || norm === "") {
      return "No";
    }
    if (norm.length > 0) return "Yes";
  }

  if (keyNorm.includes("sponsorship") || keyNorm.includes("sponsor")) {
    const needsSponsor = ["yes", "true", "required", "needed", "need", "will_need"];
    const noSponsor = ["no", "false", "not_required", "not_needed", "do_not", "dont"];
    if (needsSponsor.some((v) => norm.includes(v))) return "Yes";
    if (noSponsor.some((v) => norm.includes(v))) return "No";
    if (norm.includes("citizen") || norm.includes("permanent_resident") || norm.includes("green_card")) {
      return "No";
    }
  }

  if (keyNorm.includes("18") || keyNorm.includes("age") || keyNorm.includes("legal_age")) {
    return "Yes";
  }

  return null;
}

function fillSelect(element: HTMLSelectElement, answerValue: string, answerKey?: string): boolean {
  const options = Array.from(element.options);
  const fieldLabel = getFieldLabel(element);
  const interpreted = interpretAnswerForYesNoSelect(
    answerValue,
    (answerKey || fieldLabel || "").trim(),
    options.map((o) => o.textContent?.trim() || o.value)
  );
  if (interpreted) {
    const matchedOption = options.find(
      (o) =>
        normalizeText(o.textContent ?? "") === normalizeText(interpreted) ||
        normalizeText(o.value) === normalizeText(interpreted)
    );
    if (matchedOption) {
      element.value = matchedOption.value;
      dispatchSelectEvents(element);
      return true;
    }
  }

  const findOption = (rawAnswer: string): HTMLOptionElement | undefined => {
    const answerNorm = normalizeText(rawAnswer);
    const answerCandidates = new Set<string>([
      answerNorm,
      compactToken(answerNorm),
      alnumToken(answerNorm),
    ]);

    const answerAcronym = acronymToken(answerNorm);
    if (answerAcronym.length >= 2) {
      answerCandidates.add(answerAcronym);
    }

    const rawUpper = rawAnswer.trim().toUpperCase();
    const fullStateName = US_STATE_ABBR_TO_NAME[rawUpper];
    if (fullStateName) {
      const fullNorm = normalizeText(fullStateName);
      answerCandidates.add(fullNorm);
      answerCandidates.add(compactToken(fullNorm));
      answerCandidates.add(acronymToken(fullNorm));
    }

    const stateAbbr = US_STATE_NAME_TO_ABBR[answerNorm];
    if (stateAbbr) {
      answerCandidates.add(stateAbbr);
    }

    const directMatch = options.find((opt) => {
      const valueNorm = normalizeText(opt.value ?? "");
      const textNorm = normalizeText(opt.textContent ?? "");
      const optionCandidates = dedupeIdentifiers([
        valueNorm,
        textNorm,
        compactToken(valueNorm),
        compactToken(textNorm),
        alnumToken(valueNorm),
        alnumToken(textNorm),
        acronymToken(valueNorm),
        acronymToken(textNorm),
      ]).filter((token) => token.length > 1);

      for (const answerCandidate of answerCandidates) {
        if (!answerCandidate) continue;
        for (const optionCandidate of optionCandidates) {
          if (!optionCandidate) continue;
          if (
            optionCandidate === answerCandidate ||
            optionCandidate.includes(answerCandidate) ||
            answerCandidate.includes(optionCandidate)
          ) {
            return true;
          }
        }
      }
      return false;
    });
    if (directMatch) return directMatch;

    const answerTokens = phraseTokens(rawAnswer);
    let best: { option: HTMLOptionElement; score: number } | null = null;
    for (const option of options) {
      const optionRaw = `${option.value ?? ""} ${option.textContent ?? ""}`.trim();
      if (!optionRaw) continue;
      if (/^select(\s+one)?$/i.test(optionRaw)) continue;
      const optionTokens = phraseTokens(optionRaw);
      const score = tokenOverlapScore(answerTokens, optionTokens);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { option, score };
      }
    }

    if (best && best.score >= 0.34) {
      return best.option;
    }
    return undefined;
  };

  if (element.multiple) {
    const tokens = splitAnswerTokens(answerValue);
    const selectedValues = new Set<string>();
    for (const token of tokens) {
      const option = findOption(token);
      if (option) selectedValues.add(option.value);
    }
    if (selectedValues.size === 0) return false;
    for (const option of options) {
      option.selected = selectedValues.has(option.value);
    }
    dispatchSelectEvents(element);
    return true;
  }

  const option = findOption(answerValue);
  if (!option) return false;
  element.value = option.value;
  dispatchSelectEvents(element);
  return true;
}

const CUSTOM_DROPDOWN_CONTAINER_SELECTOR =
  '.iCIMS_InfoMsg_Job, .icims-dropdown, [class*="dropdown"], [class*="Dropdown"], [role="combobox"], [role="listbox"]';

function fillCustomDropdown(element: HTMLElement, answerValue: string): boolean {
  const container = element.closest(CUSTOM_DROPDOWN_CONTAINER_SELECTOR);
  if (!container) return false;

  const searchInput = container.querySelector<HTMLInputElement>(
    'input[type="text"]:not([type="hidden"]), input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
  );
  if (!searchInput) return false;

  setNativeValue(searchInput, answerValue);
  dispatchFieldEvents(searchInput);

  setTimeout(() => {
    const optionElements = container.querySelectorAll<HTMLElement>(
      '[role="option"], .icims-option, .dropdown-option, li[class*="option"], li[class*="Option"], .searchDropdown_option'
    );

    if (optionElements.length === 0) return;

    const answerNorm = normalizeText(answerValue);
    let bestOption: HTMLElement | null = null;
    let bestScore = 0;

    for (const opt of optionElements) {
      const optText = normalizeText(opt.textContent ?? "");
      if (!optText || /^select(\s+one)?$/i.test(optText)) continue;

      let score = 0;
      if (optText === answerNorm) {
        score = 100;
      } else if (optText.includes(answerNorm) || answerNorm.includes(optText)) {
        score = 50;
      } else {
        score = tokenOverlapScore(phraseTokens(answerValue), phraseTokens(opt.textContent ?? "")) * 30;
      }

      if (score > bestScore) {
        bestScore = score;
        bestOption = opt;
      }
    }

    if (bestOption && bestScore > 0) {
      bestOption.click();
      bestOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      bestOption.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }
  }, 600);

  return true;
}

function fillTextLikeOrCustomDropdown(
  element: HTMLInputElement | HTMLTextAreaElement,
  answerValue: string
): boolean {
  if (element.closest(CUSTOM_DROPDOWN_CONTAINER_SELECTOR)) {
    const filled = fillCustomDropdown(element, answerValue);
    if (filled) return true;
  }
  return fillTextLike(element, answerValue);
}

function getRadioLabel(input: HTMLInputElement): string {
  const explicit = input.labels ? Array.from(input.labels).map((l) => l.textContent?.trim() ?? "").join(" ") : "";
  if (explicit) return explicit;
  const ancestor = input.closest("label");
  return ancestor?.textContent?.trim() ?? "";
}

function fillRadio(input: HTMLInputElement, answerValue: string): boolean {
  const answerNorm = normalizeText(answerValue);
  const escapedName = input.name ? CSS.escape(input.name) : "";
  const candidates = escapedName
    ? Array.from(document.querySelectorAll(`input[type="radio"][name="${escapedName}"]`))
        .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    : [input];

  const target = candidates.find((candidate) => {
    const tokens = [
      candidate.value,
      candidate.id,
      candidate.getAttribute("aria-label") ?? "",
      getRadioLabel(candidate),
    ].map(normalizeText);
    return tokens.some((token) => token && (token.includes(answerNorm) || answerNorm.includes(token)));
  });

  if (!target) return false;
  if (!target.checked) {
    target.checked = true;
    dispatchFieldEvents(target);
  }
  return true;
}

function fillCheckbox(input: HTMLInputElement, answerValue: string): boolean {
  const answerNorm = normalizeText(answerValue);
  let nextChecked: boolean | null = null;

  if (isTruthyAnswer(answerValue)) nextChecked = true;
  if (isFalsyAnswer(answerValue)) nextChecked = false;

  if (nextChecked == null) {
    const tokens = splitAnswerTokens(answerValue).map(normalizeText);
    const checkboxTokens = [
      input.value,
      input.id,
      input.name,
      input.getAttribute("aria-label") ?? "",
      getLabelByFor(input),
      getAncestorLabel(input),
      getLegendText(input),
    ].map(normalizeText);
    const shouldCheck = tokens.some((answerToken) =>
      checkboxTokens.some((checkboxToken) =>
        checkboxToken && (checkboxToken.includes(answerToken) || answerToken.includes(checkboxToken))
      )
    );
    nextChecked = shouldCheck;
  }

  if (input.checked === nextChecked) return false;
  input.checked = nextChecked;
  dispatchFieldEvents(input);
  return true;
}

function normalizeValueForInputType(
  input: HTMLInputElement,
  answerValue: string
): string {
  const type = input.type.toLowerCase();
  const raw = answerValue.trim();

  if (type === "number" || type === "range") {
    const numeric = raw.replace(/,/g, "");
    const parsed = Number.parseFloat(numeric);
    if (Number.isFinite(parsed)) return String(parsed);
    return raw;
  }

  if (type === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    return raw;
  }

  if (type === "month") {
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      return `${year}-${month}`;
    }
    return raw;
  }

  if (type === "time") {
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) {
      const hh = String(Math.min(23, Number(match[1]))).padStart(2, "0");
      const mm = String(Math.min(59, Number(match[2]))).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return raw;
  }

  if (type === "datetime-local") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      const hh = String(parsed.getHours()).padStart(2, "0");
      const mm = String(parsed.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hh}:${mm}`;
    }
    return raw;
  }

  return raw;
}

function fillTextLike(element: HTMLInputElement | HTMLTextAreaElement, answerValue: string): boolean {
  const normalizedValue =
    element instanceof HTMLInputElement
      ? normalizeValueForInputType(element, answerValue)
      : answerValue;
  setNativeValue(element, normalizedValue);
  dispatchFieldEvents(element);
  return true;
}

function fillFields(matches: FieldMatch[]): number {
  let filledCount = 0;

  for (const { element, answerValue, answerKey } of matches) {
    if (filledElements.has(element)) continue;

    let filled = false;
    if (element instanceof HTMLSelectElement) {
      filled = fillSelect(element, answerValue, answerKey);
    } else if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      if (type === "checkbox") {
        filled = fillCheckbox(element, answerValue);
      } else if (type === "radio") {
        filled = fillRadio(element, answerValue);
      } else if (isTextLikeInput(type)) {
        filled = fillTextLikeOrCustomDropdown(element, answerValue);
      }
    } else {
      filled = fillTextLikeOrCustomDropdown(element, answerValue);
    }

    if (filled) {
      filledElements.add(element);
      filledCount += 1;
    }
  }

  return filledCount;
}

function applyMatchesAndCollectResults(
  fields: ScannedField[],
  matches: FieldMatch[]
): { filledCount: number; results: FieldResultItem[] } {
  const matchedByElement = new Map<FillableElement, FieldMatch>();
  for (const match of matches) {
    matchedByElement.set(match.element, match);
  }

  const results: FieldResultItem[] = [];
  let filledCount = 0;

  for (const field of fields) {
    const element = field.element;
    const selector = buildElementSelector(element);
    const label = getBestFieldLabel(element) || selector;
    const match = matchedByElement.get(element) ?? null;

    if (!match) {
      results.push({ selector, label, action: "skipped", reason: "no_answer_match" });
      continue;
    }

    // Reuse fillFields logic for a single element
    const before = filledElements.has(element);
    const filledNow = (() => {
      if (before) return true;
      if (element instanceof HTMLSelectElement) return fillSelect(element, match.answerValue, match.answerKey);
      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        if (type === "checkbox") return fillCheckbox(element, match.answerValue);
        if (type === "radio") return fillRadio(element, match.answerValue);
        if (isTextLikeInput(type)) return fillTextLikeOrCustomDropdown(element, match.answerValue);
        return false;
      }
      return fillTextLikeOrCustomDropdown(element, match.answerValue);
    })();

    if (filledNow) {
      if (!before) {
        filledElements.add(element);
        filledCount += 1;
      }
      results.push({ selector, label, action: "filled", reason: "filled", answerKey: match.answerKey });
    } else {
      results.push({ selector, label, action: "skipped", reason: "fill_failed", answerKey: match.answerKey });
    }
  }

  return { filledCount, results };
}

async function getAutofillAnswers(): Promise<AutofillAnswerMap> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.AUTOFILL_ANSWERS]);
  const raw = result[STORAGE_KEYS.AUTOFILL_ANSWERS];
  if (!raw || typeof raw !== "object") return {};

  const answers: AutofillAnswerMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) continue;
    answers[normalizedKey] = normalizedValue;
  }
  return answers;
}

async function getUploadDecisions(): Promise<UploadDecisionMap> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS]);
  const raw = result[STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS];
  if (!raw || typeof raw !== "object") return {};
  const now = Date.now();
  const decisions: UploadDecisionMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const decision = (value as { decision?: unknown }).decision;
    const ts = (value as { ts?: unknown }).ts;
    if (decision !== "resolved_by_user" && decision !== "skipped_by_user") continue;
    if (typeof ts !== "number") continue;
    if (now - ts > UPLOAD_DECISION_TTL_MS) continue;
    decisions[key] = { decision, ts };
  }
  return decisions;
}

async function persistUploadDecision(
  selector: string,
  subType: FileUploadBlockerSubType | string,
  decision: FileUploadBlockerDecision
): Promise<void> {
  const key = toBlockerDecisionKey(selector, subType);
  const existing = await getUploadDecisions();
  existing[key] = { decision, ts: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTOFILL_UPLOAD_DECISIONS]: existing });
}

function detectPendingUploadBlocker(decisions: UploadDecisionMap): FormBlocker | null {
  const fileInputs = collectFileInputs();
  if (fileInputs.length === 0) return null;

  const blockers: FormBlocker[] = [];
  for (const input of fileInputs) {
    if (input.disabled) continue;
    const signals = getFileInputSignals(input);
    const subType = classifyUploadSubType(signals);
    if (subType !== "resume" && subType !== "cover_letter") continue;
    const hasFiles = Boolean(input.files && input.files.length > 0);
    if (hasFiles) continue;
    const selector = buildElementSelector(input);
    const key = toBlockerDecisionKey(selector, subType);
    if (decisions[key]) continue;
    blockers.push({
      type: "file_upload",
      selector,
      label: signals[0] || "Upload required",
      subType,
      resolved: false,
    });
  }

  if (blockers.length === 0) return null;
  blockers.sort((a, b) => {
    const priority = (item: FormBlocker): number => {
      if (item.subType === "resume") return 0;
      if (item.subType === "cover_letter") return 1;
      return 2;
    };
    return priority(a) - priority(b);
  });
  return blockers[0] ?? null;
}

// ---------------------------------------------------------------------------
// Custom dropdown support (Workday, Taleo, iCIMS custom comboboxes)
// ---------------------------------------------------------------------------

type CustomDropdownField = {
  trigger: HTMLElement;
  identifiers: string[];
  label: string;
};

function scanCustomDropdownFields(): CustomDropdownField[] {
  const results: CustomDropdownField[] = [];
  const seen = new WeakSet<Element>();

  const triggers = document.querySelectorAll<HTMLElement>(
    'button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(select):not(textarea)'
  );

  for (const el of triggers) {
    if (seen.has(el) || filledElements.has(el)) continue;
    seen.add(el);
    if (!isElementVisible(el)) continue;

    const currentText = el.textContent?.trim() ?? "";
    if (
      currentText &&
      currentText.length < 100 &&
      !/^(select(\s+one)?|choose(\s+one)?|--|—|please\s+select)$/i.test(currentText)
    ) {
      continue;
    }

    const container =
      el.closest("[data-automation-id^='formField']") ??
      el.closest("fieldset") ??
      el.closest("[class*='formField']") ??
      el.parentElement?.parentElement;
    if (!container) continue;

    const labelEl =
      container.querySelector("label") ??
      container.querySelector("[data-automation-id^='formLabel']");
    const labelText = labelEl?.textContent?.trim() ?? "";
    if (!labelText) continue;

    const identifiers = dedupeIdentifiers([
      labelText,
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("data-automation-id") ?? "",
    ]);
    if (identifiers.length === 0) continue;
    results.push({ trigger: el, identifiers, label: labelText });
  }

  return results;
}

function matchCustomDropdowns(
  fields: CustomDropdownField[],
  answers: AutofillAnswerMap
): Array<{ field: CustomDropdownField; answerValue: string; answerKey: string }> {
  const entries = Object.entries(answers)
    .map(([key, value]) => ({ key, keyNorm: normalizeText(key), value }))
    .filter((e) => e.keyNorm.length > 1 && e.value.trim().length > 0);

  const out: Array<{ field: CustomDropdownField; answerValue: string; answerKey: string }> = [];

  for (const field of fields) {
    let best: { score: number; answerValue: string; answerKey: string } | null = null;
    const ids = field.identifiers.map(normalizeText).filter((id) => id.length > 1);
    for (const id of ids) {
      for (const e of entries) {
        if (BLOCKED_MATCH_PAIRS.has(`${id}|${e.keyNorm}`)) continue;
        if (!isStrongMatch(id, e.keyNorm)) continue;
        let score = 0;
        if (id === e.keyNorm) {
          score = 1000;
        } else {
          const a = id.split(/[_\s]+/).filter((t) => t.length > 0);
          const b = e.keyNorm.split(/[_\s]+/).filter((t) => t.length > 0);
          score = a.filter((t) => b.includes(t)).length * 100 + Math.min(id.length, e.keyNorm.length);
        }
        if (!best || score > best.score) {
          best = { score, answerValue: e.value, answerKey: e.key };
        }
      }
    }
    if (best) out.push({ field, ...best });
  }
  return out;
}

async function fillSingleCustomDropdown(
  trigger: HTMLElement,
  answerValue: string,
  answerKey: string,
  label: string
): Promise<boolean> {
  trigger.scrollIntoView({ block: "nearest" });
  trigger.focus();
  trigger.click();
  await new Promise((r) => setTimeout(r, 400));

  let listbox = document.querySelector<HTMLElement>('[role="listbox"]:not([hidden])');
  if (!listbox) {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    listbox = document.querySelector<HTMLElement>('[role="listbox"]:not([hidden])');
  }

  const options = listbox
    ? Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
    : Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]:not([hidden]) [role="option"]'));

  if (options.length === 0) {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  const optionTexts = options.map((o) => o.textContent?.trim() ?? "");
  const yesNoResult = interpretAnswerForYesNoSelect(answerValue, answerKey || label, optionTexts);
  const targetValue = yesNoResult ?? answerValue;
  const targetNorm = normalizeText(targetValue);

  let bestOption: HTMLElement | null = null;
  let bestScore = 0;

  for (const opt of options) {
    const optText = normalizeText(opt.textContent ?? "");
    if (!optText || /^(select(\s+one)?|choose(\s+one)?|--|—)$/i.test(optText)) continue;

    let score = 0;
    if (optText === targetNorm) {
      score = 100;
    } else if (optText.includes(targetNorm) || targetNorm.includes(optText)) {
      score = 50;
    } else {
      score = tokenOverlapScore(phraseTokens(targetValue), phraseTokens(opt.textContent ?? "")) * 30;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOption = opt;
    }
  }

  if (!bestOption || bestScore <= 0) {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  bestOption.click();
  await new Promise((r) => setTimeout(r, 120));
  return true;
}

async function runCustomDropdownPass(
  answers: AutofillAnswerMap
): Promise<{ filled: number; results: FieldResultItem[] }> {
  const dropdowns = scanCustomDropdownFields();
  if (dropdowns.length === 0) return { filled: 0, results: [] };
  console.log(`[Autofill] Custom dropdown pass: found ${dropdowns.length} dropdowns`);

  const matches = matchCustomDropdowns(dropdowns, answers);
  console.log(`[Autofill] Custom dropdown pass: matched ${matches.length}`);

  const results: FieldResultItem[] = [];
  let filled = 0;

  for (const m of matches) {
    const selector = buildElementSelector(m.field.trigger);
    const ok = await fillSingleCustomDropdown(m.field.trigger, m.answerValue, m.answerKey, m.field.label);
    if (ok) {
      filledElements.add(m.field.trigger);
      filled += 1;
      results.push({ selector, label: m.field.label, action: "filled", reason: "filled", answerKey: m.answerKey });
    } else {
      results.push({ selector, label: m.field.label, action: "skipped", reason: "fill_failed", answerKey: m.answerKey });
    }
  }

  for (const dd of dropdowns) {
    if (matches.some((m) => m.field.trigger === dd.trigger)) continue;
    results.push({ selector: buildElementSelector(dd.trigger), label: dd.label, action: "skipped", reason: "no_answer_match" });
  }

  return { filled, results };
}

function maybeStartMutationObserverAfterRun(): void {
  if (!autofillActivated || observerStarted || !document.body) return;
  observerStarted = true;
  const observer = new MutationObserver(() => {
    scheduleAutofill();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function runAutofill(): Promise<void> {
  if (extensionContextDead) return;
  if (!isExtensionContextValid()) {
    extensionContextDead = true;
    showExtensionInvalidatedBannerOnce();
    console.warn(
      "[Autofill] Extension context invalidated (extension was reloaded). Refresh this page to use autofill."
    );
    return;
  }
  if (autofillRunning) return;
  if (pipelineRunCount >= MAX_PIPELINE_RUNS_PER_ACTIVATION) {
    console.log("[Autofill] Max pipeline runs reached. Stopping observer retriggers.");
    return;
  }
  pipelineRunCount += 1;
  autofillRunning = true;

  try {
    console.log("[Autofill] Trigger received. Running pipeline...");
    console.log("[Autofill] Step 1: Reading answers from local storage...");
    const answers = await getAutofillAnswers();
    const answerCount = Object.keys(answers).length;
    console.log(`[Autofill] Step 1 result: loaded ${answerCount} answers`);
    const educationAnswerKeys = Object.keys(answers).filter((key) =>
      /^education_history_\d+_(university|degree|field_of_study|gpa)$/i.test(key)
    );
    if (educationAnswerKeys.length === 0) {
      console.warn("[Autofill] Education history answers not found; using generic education keys.");
    } else {
      console.log(`[Autofill] Step 1 detail: found ${educationAnswerKeys.length} education history answers`);
    }
    if (answerCount === 0) {
      emitAutofillProgress(buildProgress({ state: "complete", total: 0, filled: 0, completed: true }));
      return;
    }

    const uploadDecisions = await getUploadDecisions();
    const pendingUploadBlocker = detectPendingUploadBlocker(uploadDecisions);
    if (pendingUploadBlocker) {
      blockedOnUpload = true;
      const blockerKey = toBlockerDecisionKey(
        pendingUploadBlocker.selector,
        pendingUploadBlocker.subType ?? "generic"
      );
      if (lastBlockedKey !== blockerKey) {
        lastBlockedKey = blockerKey;
        emitAutofillProgress(
          buildProgress({
            state: "blocked",
            total: 0,
            filled: 0,
            paused: true,
            completed: false,
            activeBlocker: pendingUploadBlocker,
          })
        );
      }
      console.log(`[Autofill] Blocked on upload requirement (${pendingUploadBlocker.subType ?? "generic"})`);
      return;
    }
    blockedOnUpload = false;
    lastBlockedKey = null;
    emitAutofillProgress(buildProgress({ state: "apply", total: 0, filled: 0, completed: false }));

    // ---- Step 2: Scan native form elements ----
    const nodes = collectFillableElements();
    const stats = computeScanStats(nodes);
    const fields = scanFormFields(nodes);
    console.log(
      `[Autofill] Step 2: Scanned ${fields.length} native fields (eligible=${stats.eligibleControls}, controls=${stats.totalControls}, inputs=${stats.totalInputs}, selects=${stats.totalSelects}, textareas=${stats.totalTextareas}, fileInputs=${stats.fileInputs})`
    );

    // ---- Step 3: Match and fill native fields ----
    let nativeFilled = 0;
    let nativeResults: FieldResultItem[] = [];

    if (fields.length > 0) {
      const matches = matchFieldsToAnswers(fields, answers);
      console.log(`[Autofill] Step 3: Matched ${matches.length} native fields`);

      if (matches.length > 0) {
        const applied = applyMatchesAndCollectResults(fields, matches);
        nativeFilled = applied.filledCount;
        nativeResults = applied.results;
      } else {
        nativeResults = fields.map((f) => {
          const selector = buildElementSelector(f.element);
          const label = getBestFieldLabel(f.element) || selector;
          return { selector, label, action: "skipped", reason: "no_answer_match" } satisfies FieldResultItem;
        });
      }
      console.log(`[Autofill] Step 3 result: Filled ${nativeFilled} native fields`);
    }

    // ---- Step 4: Scan, match, and fill custom dropdowns (Workday, etc.) ----
    const customResult = await runCustomDropdownPass(answers);
    console.log(`[Autofill] Step 4: Filled ${customResult.filled} custom dropdowns`);

    // ---- Step 5: Combine results and emit final progress ----
    const totalFields = fields.length + customResult.results.length;
    const totalFilled = nativeFilled + customResult.filled;
    const allResults = [...nativeResults, ...customResult.results];
    console.log(`[Autofill] Step 5: Total ${totalFilled}/${totalFields} fields filled`);

    const progress = buildProgress({
      state: "complete",
      total: totalFields,
      filled: totalFilled,
      skipped: Math.max(0, totalFields - totalFilled),
      completed: true,
    });
    progress.fields = allResults;
    emitAutofillProgress(progress);
    maybeStartMutationObserverAfterRun();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/extension context invalidated|context invalidated/i.test(msg)) {
      extensionContextDead = true;
      showExtensionInvalidatedBannerOnce();
      console.warn("[Autofill] Extension context invalidated during run — refresh this page.");
    } else {
      console.warn("AUTOFILL: runAutofill failed", err);
    }
    if (!extensionContextDead) {
      emitAutofillProgress(buildProgress({ state: "stopped", total: 0, filled: 0, completed: true }));
    }
  } finally {
    autofillRunning = false;
  }
}

function scheduleAutofill(): void {
  if (extensionContextDead) return;
  if (!autofillActivated) return;
  if (blockedOnUpload) return;
  if (debounceTimer != null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    void runAutofill();
  }, 1500);
}

function initialize(): void {
  try {
    if (window.self !== window.top) return;
  } catch {
    return; // cross-origin iframe
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && changes[STORAGE_KEYS.AUTOFILL_TRIGGER_TS]) {
      const newVal = changes[STORAGE_KEYS.AUTOFILL_TRIGGER_TS].newValue;
      if (newVal && typeof newVal === "number") {
        autofillActivated = true;
        blockedOnUpload = false;
        pipelineRunCount = 0;
        filledElements = new WeakSet();
        lastProgressSignature = null;
        console.log("[Autofill] Trigger received via storage change");
        void runAutofill();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const action = (message as { action?: string } | null)?.action;
    if (action === "run_autofill") {
      autofillActivated = true;
      blockedOnUpload = false;
      pipelineRunCount = 0;
      filledElements = new WeakSet();
      lastProgressSignature = null;
      console.log("[Autofill] Trigger received via message");
      void runAutofill();
      sendResponse({ ok: true });
      return true;
    }

    const typed = message as {
      type?: string;
      data?: {
        selector?: string;
        subType?: FileUploadBlockerSubType | string;
        decision?: FileUploadBlockerDecision;
      };
    } | null;

    if (typed?.type === MSG.AUTOFILL_UPLOAD_BLOCKER_DECISION) {
      const selector = typed.data?.selector?.trim();
      const subType = typed.data?.subType ?? "generic";
      const decision = typed.data?.decision;
      if (!selector || (decision !== "resolved_by_user" && decision !== "skipped_by_user")) {
        return false;
      }
      blockedOnUpload = false;
      pipelineRunCount = 0;
      console.log(`[Autofill] Upload blocker decision received: ${decision} (${subType})`);
      void persistUploadDecision(selector, subType, decision);
      return false;
    }

    return false;
  });

  console.log("[Autofill] Content script initialized (waiting for user trigger)");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
