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
};

type UploadDecisionEntry = {
  decision: FileUploadBlockerDecision;
  ts: number;
};

type UploadDecisionMap = Record<string, UploadDecisionEntry>;

const filledElements = new WeakSet<Element>();
let observerStarted = false;
let autofillRunning = false;
let debounceTimer: number | null = null;
let lastBlockedKey: string | null = null;
let lastProgressSignature: string | null = null;

const UPLOAD_DECISION_TTL_MS = 20 * 60 * 1000;

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
          matches.push({ element: field.element, answerValue: educationValue });
          continue;
        }
      }
    }

    let best: { score: number; answerValue: string } | null = null;
    const normalizedIdentifiers = field.identifiers.map(normalizeText).filter((id) => id.length > 1);

    for (const identifier of normalizedIdentifiers) {
      for (const answerEntry of answerEntries) {
        const isMatch =
          identifier.includes(answerEntry.keyNorm) ||
          answerEntry.keyNorm.includes(identifier);
        if (!isMatch) continue;

        const score = Math.max(identifier.length, answerEntry.keyNorm.length);
        if (!best || score > best.score) {
          best = { score, answerValue: answerEntry.value };
        }
      }
    }

    if (best) {
      matches.push({ element: field.element, answerValue: best.answerValue });
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

function fillSelect(element: HTMLSelectElement, answerValue: string): boolean {
  const options = Array.from(element.options);
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
    dispatchFieldEvents(element);
    return true;
  }

  const option = findOption(answerValue);
  if (!option) return false;
  element.value = option.value;
  dispatchFieldEvents(element);
  return true;
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

  for (const { element, answerValue } of matches) {
    if (filledElements.has(element)) continue;

    let filled = false;
    if (element instanceof HTMLSelectElement) {
      filled = fillSelect(element, answerValue);
    } else if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      if (type === "checkbox") {
        filled = fillCheckbox(element, answerValue);
      } else if (type === "radio") {
        filled = fillRadio(element, answerValue);
      } else if (isTextLikeInput(type)) {
        filled = fillTextLike(element, answerValue);
      }
    } else {
      filled = fillTextLike(element, answerValue);
    }

    if (filled) {
      filledElements.add(element);
      filledCount += 1;
    }
  }

  return filledCount;
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

async function runAutofill(): Promise<void> {
  if (autofillRunning) return;
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
    lastBlockedKey = null;
    emitAutofillProgress(buildProgress({ state: "apply", total: 0, filled: 0, completed: false }));

    const nodes = collectFillableElements();
    const stats = computeScanStats(nodes);
    const fields = scanFormFields(nodes);
    console.log(
      `[Autofill] Step 2: Scanned ${fields.length} fields (eligible=${stats.eligibleControls}, controls=${stats.totalControls}, inputs=${stats.totalInputs}, selects=${stats.totalSelects}, textareas=${stats.totalTextareas}, fileInputs=${stats.fileInputs})`
    );
    if (fields.length === 0) {
      emitAutofillProgress(buildProgress({ state: "complete", total: 0, filled: 0, completed: true }));
      return;
    }

    const matches = matchFieldsToAnswers(fields, answers);
    console.log(`[Autofill] Step 3: Matched ${matches.length} fields`);
    if (matches.length === 0) {
      emitAutofillProgress(
        buildProgress({
          state: "complete",
          total: fields.length,
          filled: 0,
          skipped: fields.length,
          completed: true,
        })
      );
      return;
    }

    const filled = fillFields(matches);
    console.log(`[Autofill] Step 4: Filled ${filled} fields`);
    emitAutofillProgress(
      buildProgress({
        state: "complete",
        total: fields.length,
        filled,
        skipped: Math.max(0, fields.length - filled),
        completed: true,
      })
    );
  } catch (err) {
    console.warn("AUTOFILL: runAutofill failed", err);
    emitAutofillProgress(buildProgress({ state: "stopped", total: 0, filled: 0, completed: true }));
  } finally {
    autofillRunning = false;
  }
}

function scheduleAutofill(): void {
  if (debounceTimer != null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    void runAutofill();
  }, 500);
}

function startObserver(): void {
  if (observerStarted) return;
  if (!document.body) return;
  observerStarted = true;

  const observer = new MutationObserver(() => {
    scheduleAutofill();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const action = (message as { action?: string } | null)?.action;
  if (action === "run_autofill") {
    console.log("[Autofill] Trigger message received (run_autofill)");
    lastProgressSignature = null;
    void runAutofill();
    return;
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
      return;
    }
    console.log(`[Autofill] Upload blocker decision received: ${decision} (${subType})`);
    void persistUploadDecision(selector, subType, decision);
  }
});

function initialize(): void {
  console.log("[Autofill] Content script initialized");
  void runAutofill();
  startObserver();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
