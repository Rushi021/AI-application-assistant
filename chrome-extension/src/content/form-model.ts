/**
 * State A: Page Intake — Builds a structured Form Model from the DOM.
 * Output: fields[], actions[], blockers[], sections[]
 */

import type { FormModel, FormField, FormAction, FormBlocker } from "@/shared/types";

// ---------------------------------------------------------------------------
// Signal extraction (label resolution order: label[for] → aria-label → aria-labelledby → closest label → placeholder)
// ---------------------------------------------------------------------------

/** Smart label extraction: ordered resolution for Pass 2 keyword matching. */
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

function getAssociatedLabel(el: HTMLElement): string | null {
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

function getNearbyText(el: Element, levels = 2): string | null {
  let node: Element | null = el.parentElement;
  for (let i = 0; i < levels && node; i++) {
    const text = node.textContent?.trim().slice(0, 100);
    if (text && text.length > 2) return text;
    node = node.parentElement;
  }
  return null;
}

function getSignals(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
  const signals: string[] = [];
  if (el.name) signals.push(el.name);
  if (el.id) signals.push(el.id);
  if ("placeholder" in el && el.placeholder) signals.push(el.placeholder);
  if (el.getAttribute("aria-label")) signals.push(el.getAttribute("aria-label")!);
  if (el.getAttribute("autocomplete")) signals.push(el.getAttribute("autocomplete")!);
  if (el.getAttribute("data-testid")) signals.push(el.getAttribute("data-testid")!);
  if (el instanceof HTMLInputElement && el.type) signals.push(`type:${el.type}`);

  const labelText = getAssociatedLabel(el);
  if (labelText) signals.push(labelText);

  const nearbyText = getNearbyText(el);
  if (nearbyText) signals.push(nearbyText);

  return signals.filter(Boolean);
}

function getSignalsWithSource(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): Array<{ source: string; value: string }> {
  const out: Array<{ source: string; value: string }> = [];
  if (el.getAttribute("autocomplete")) {
    out.push({ source: "autocomplete", value: el.getAttribute("autocomplete")! });
  }
  if (el instanceof HTMLInputElement && el.type) {
    out.push({ source: "type", value: el.type });
  }
  if (el.name) out.push({ source: "name", value: el.name });
  if (el.id) out.push({ source: "id", value: el.id });
  if ("placeholder" in el && el.placeholder) {
    out.push({ source: "placeholder", value: el.placeholder });
  }
  if (el.getAttribute("aria-label")) {
    out.push({ source: "aria-label", value: el.getAttribute("aria-label")! });
  }
  const labelText = getAssociatedLabel(el);
  if (labelText) out.push({ source: "label", value: labelText });
  const nearbyText = getNearbyText(el);
  if (nearbyText) out.push({ source: "nearby", value: nearbyText });
  if (el.hasAttribute("required")) out.push({ source: "required", value: "true" });
  const pattern = el.getAttribute("pattern");
  if (pattern) out.push({ source: "pattern", value: pattern });
  const minLen = el.getAttribute("minLength") ?? (el as HTMLInputElement).minLength;
  if (minLen != null && minLen !== -1) out.push({ source: "minLength", value: String(minLen) });
  const maxLen = el.getAttribute("maxLength") ?? (el as HTMLInputElement).maxLength;
  if (maxLen != null && maxLen !== -1) out.push({ source: "maxLength", value: String(maxLen) });
  return out;
}

function getFieldLabel(el: HTMLElement, signals: string[]): string {
  const label = getAssociatedLabel(el);
  if (label && label.length < 100) return label;
  if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder;
  const name = (el as HTMLInputElement).name || el.id;
  if (name) return name.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return "Unknown field";
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function generateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute("name");
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`));
    const index = siblings.indexOf(el);
    if (index >= 0) {
      const parentSelector = parent.id ? `#${CSS.escape(parent.id)}` : parent.tagName.toLowerCase();
      return `${parentSelector} > ${tag}:nth-of-type(${index + 1})`;
    }
  }
  return tag;
}

// ---------------------------------------------------------------------------
// Section detection (steps, tabs, sections)
// ---------------------------------------------------------------------------

function detectSection(el: Element): string | null {
  const sectionContainer = el.closest(
    "[class*='section'], [class*='step'], [class*='tab'], [class*='panel'], [data-step], [data-section]"
  );
  if (!sectionContainer) return null;

  const heading = sectionContainer.querySelector("h1, h2, h3, h4, [role='heading'], .section-title, .step-title");
  if (heading?.textContent) {
    return heading.textContent.trim().slice(0, 80);
  }

  const ariaLabel = sectionContainer.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  return "Section";
}

// ---------------------------------------------------------------------------
// Actions detection (Next, Submit, Continue)
// ---------------------------------------------------------------------------

function detectActions(): FormAction[] {
  const actions: FormAction[] = [];
  const buttons = document.querySelectorAll(
    'button, input[type="submit"], [role="button"], a[class*="button"], [data-testid*="submit"], [data-testid*="next"]'
  );

  const nextPatterns = [
    /next/i,
    /continue/i,
    /proceed/i,
    /save and continue/i,
    /submit and continue/i,
    /forward/i,
  ];
  const submitPatterns = [/submit/i, /apply/i, /send application/i, /finish/i, /done/i];

  buttons.forEach((btn) => {
    if (!isVisible(btn)) return;

    const text = (btn.textContent || (btn as HTMLInputElement).value || "").trim().toLowerCase();
    const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || "";
    const combined = text + " " + ariaLabel;

    let type: FormAction["type"] | null = null;
    if (submitPatterns.some((p) => p.test(combined))) type = "submit";
    else if (nextPatterns.some((p) => p.test(combined))) type = "next";

    if (type) {
      const selector = generateSelector(btn);
      if (!actions.some((a) => a.selector === selector)) {
        actions.push({
          type,
          selector,
          label: (btn.textContent || (btn as HTMLInputElement).value || "Button").trim().slice(0, 60),
        });
      }
    }
  });

  return actions;
}

// ---------------------------------------------------------------------------
// Blocker detection (CAPTCHA, OTP, file upload, agreement)
// ---------------------------------------------------------------------------

function detectBlockers(): FormBlocker[] {
  const blockers: FormBlocker[] = [];

  // CAPTCHA
  const captchaSelectors = [
    '[src*="recaptcha"]',
    '[src*="captcha"]',
    '.g-recaptcha',
    '[data-sitekey]',
    'iframe[title*="reCAPTCHA"]',
    '[class*="captcha"]',
    '[id*="captcha"]',
  ];
  for (const sel of captchaSelectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) {
      blockers.push({
        type: "captcha",
        selector: generateSelector(el),
        label: "CAPTCHA verification required",
        resolved: false,
      });
      break;
    }
  }

  // OTP / verification code
  const otpInputs = document.querySelectorAll(
    'input[type="text"][placeholder*="code"], input[placeholder*="verification"], input[placeholder*="OTP"], input[name*="otp"], input[name*="verification"]'
  );
  otpInputs.forEach((el) => {
    if (isVisible(el)) {
      blockers.push({
        type: "otp",
        selector: generateSelector(el),
        label: "Verification code / OTP required",
        resolved: false,
      });
    }
  });

  // File upload
  const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  fileInputs.forEach((el) => {
    if (!isVisible(el)) return;
    const signals = getSignals(el);
    const label = getFieldLabel(el, signals);
    const isResume = /resume|cv|curriculum/i.test(signals.join(" "));
    const isCoverLetter = /cover.?letter/i.test(signals.join(" "));
    const subType = isResume ? "resume" : isCoverLetter ? "cover_letter" : "generic";

    blockers.push({
      type: "file_upload",
      selector: generateSelector(el),
      label,
      subType,
      resolved: !!(el.files && el.files.length > 0),
    });
  });

  // Agreement checkboxes ("I agree", "I accept")
  const agreementInputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]'
  );
  agreementInputs.forEach((el) => {
    if (!isVisible(el)) return;
    const signals = getSignals(el);
    const combined = signals.join(" ").toLowerCase();
    if (/agree|accept|terms|conditions|consent/i.test(combined) && !el.checked) {
      blockers.push({
        type: "agreement",
        selector: generateSelector(el),
        label: getFieldLabel(el, signals),
        resolved: el.checked,
      });
    }
  });

  return blockers;
}

// ---------------------------------------------------------------------------
// Custom dropdown detection (ARIA combobox/listbox)
// ---------------------------------------------------------------------------

function detectCustomDropdowns(): FormField[] {
  const fields: FormField[] = [];
  const comboboxes = document.querySelectorAll('[role="combobox"][aria-haspopup="listbox"]');

  comboboxes.forEach((el, idx) => {
    if (!isVisible(el)) return;
    if (el.closest("select") || el.querySelector("select")) return;

    const trigger = el;
    const triggerSelector = generateSelector(trigger as Element);
    const selector = triggerSelector;

    const label =
      el.getAttribute("aria-label") ??
      (el.querySelector("label")?.textContent?.trim() ?? `Custom dropdown ${idx + 1}`);

    fields.push({
      selector,
      fieldType: "unknown",
      label,
      fieldKind: "custom_select",
      triggerSelector,
      signals: [label, el.getAttribute("aria-label") ?? ""].filter(Boolean),
      required: el.getAttribute("aria-required") === "true",
      visible: true,
      enabled: true,
      filled: false,
      manual: false,
      profileValue: null,
      confidence: 0,
      confidenceTier: "C",
      section: detectSection(el),
    });
  });

  return fields;
}

// ---------------------------------------------------------------------------
// Shadow DOM: collect inputs from document and all shadow roots
// ---------------------------------------------------------------------------

function collectInputs(root: Document | ShadowRoot): Element[] {
  const list: Element[] = [];

  function walk(currentRoot: Document | ShadowRoot) {
    const fields = currentRoot.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
    );
    list.push(...Array.from(fields));

    const all = currentRoot.querySelectorAll("*");
    for (const el of all) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  }

  walk(root);
  return list;
}

function collectContentEditable(root: Document | ShadowRoot): HTMLElement[] {
  const list: HTMLElement[] = [];

  function walk(currentRoot: Document | ShadowRoot) {
    const editables = currentRoot.querySelectorAll<HTMLElement>('[contenteditable="true"]');
    editables.forEach((el) => {
      if (isVisible(el) && (el.textContent?.length ?? 0) < 5000) list.push(el);
    });
    const all = currentRoot.querySelectorAll("*");
    for (const el of all) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  }

  walk(root);
  return list;
}

function detectFieldGroup(
  el: Element,
  signals: string[],
  label: string
): string | null {
  const combined = [...signals, label].join(" ").toLowerCase();
  if (
    /address|street|city|state|zip|postal|country/.test(combined)
  ) {
    return "address";
  }
  if (/first.?name|last.?name|full.?name|given|family/.test(combined)) {
    return "name";
  }
  if (/phone|mobile|tel|contact.?number/.test(combined)) {
    return "phone";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main API: build Form Model
// ---------------------------------------------------------------------------

export function buildFormModel(): FormModel {
  const fields: FormField[] = [];
  const inputElements = collectInputs(document);

  // Skip file inputs (handled as blockers)
  const fileInputSelectors = new Set(
    Array.from(document.querySelectorAll('input[type="file"]')).map((el) => generateSelector(el))
  );

  inputElements.forEach((el) => {
    const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (fileInputSelectors.has(generateSelector(el))) return;
    if (!isVisible(el)) return;

    const signals = getSignals(inputEl);
    const signalsWithSource = getSignalsWithSource(inputEl);
    const required =
      inputEl.hasAttribute("required") ||
      inputEl.getAttribute("aria-required") === "true" ||
      /required|mandatory/i.test(signals.join(" "));
    const enabled = !inputEl.disabled && !inputEl.hasAttribute("readonly");
    const isFilled = !!((inputEl as HTMLInputElement).value && String((inputEl as HTMLInputElement).value).trim());

    fields.push({
      selector: generateSelector(el),
      fieldType: "unknown", // populated by field-matcher
      label: getFieldLabel(inputEl, signals),
      fieldKind: "native",
      signals,
      signalsWithSource,
      required,
      visible: true,
      enabled,
      filled: isFilled,
      manual: false,
      profileValue: null,
      confidence: 0,
      confidenceTier: "C",
      section: detectSection(el),
      groupId: detectFieldGroup(el, signals, getFieldLabel(inputEl, signals)),
    });
  });

  const customDropdownFields = detectCustomDropdowns();
  fields.push(...customDropdownFields);

  const contentEditableElements = collectContentEditable(document);
  contentEditableElements.forEach((el) => {
    const selector = generateSelector(el);
    const label = getLabelTextForElement(el) || getAssociatedLabel(el) || "Editable field";
    const signals = [label, el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""].filter(Boolean);
    fields.push({
      selector,
      fieldType: "unknown",
      label: label.slice(0, 100),
      fieldKind: "contenteditable",
      signals,
      signalsWithSource: signals.map((s) => ({ source: "label", value: s })),
      required: false,
      visible: true,
      enabled: !el.hasAttribute("contenteditable") || el.getAttribute("contenteditable") === "true",
      filled: !!(el.textContent?.trim()),
      manual: false,
      profileValue: null,
      confidence: 0,
      confidenceTier: "C",
      section: detectSection(el),
      groupId: null,
    });
  });

  const actions = detectActions();
  const blockers = detectBlockers();
  const sections = [...new Set(fields.map((f) => f.section).filter(Boolean))] as string[];

  return {
    fields,
    actions,
    blockers,
    sections,
  };
}
