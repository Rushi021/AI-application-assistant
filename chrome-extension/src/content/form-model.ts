/**
 * State A: Page Intake — Builds a structured Form Model from the DOM.
 * Output: fields[], actions[], blockers[], sections[]
 */

import type { FormModel, FormField, FormAction, FormBlocker } from "@/shared/types";

// ---------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------

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

  const parent = el.closest("[class*='field'], [class*='form-group'], [class*='input'], label");
  if (parent) {
    const parentText = parent.textContent?.trim().slice(0, 100);
    if (parentText) signals.push(parentText);
  }

  return signals.filter(Boolean);
}

function getAssociatedLabel(el: HTMLElement): string | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) {
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

  return null;
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
// Main API: build Form Model
// ---------------------------------------------------------------------------

export function buildFormModel(): FormModel {
  const fields: FormField[] = [];
  const inputs = document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
  );

  // Skip file inputs (handled as blockers)
  const fileInputSelectors = new Set(
    Array.from(document.querySelectorAll('input[type="file"]')).map((el) => generateSelector(el))
  );

  inputs.forEach((el) => {
    if (fileInputSelectors.has(generateSelector(el))) return;
    if (!isVisible(el)) return;

    const signals = getSignals(el);
    const required =
      el.hasAttribute("required") ||
      el.getAttribute("aria-required") === "true" ||
      /required|mandatory/i.test(signals.join(" "));
    const enabled = !el.disabled && !el.hasAttribute("readonly");
    const isFilled = !!(el.value && String(el.value).trim());

    fields.push({
      selector: generateSelector(el),
      fieldType: "unknown", // populated by field-matcher
      label: getFieldLabel(el, signals),
      signals,
      required,
      visible: true,
      enabled,
      filled: isFilled,
      manual: false,
      profileValue: null,
      confidence: 0,
      confidenceTier: "low",
      section: detectSection(el),
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
