/**
 * Detects form fields on job application pages and maps them to
 * user profile field types based on multiple signals.
 */

import type { DetectedField } from "@/shared/types";

// ---------------------------------------------------------------------------
// Field type patterns — each key is a profile field, each value is a list
// of patterns that match form field attributes / labels.
// ---------------------------------------------------------------------------

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  first_name: [/first.?name/i, /given.?name/i, /fname/i, /^first$/i, /prenom/i],
  last_name: [/last.?name/i, /sur.?name/i, /family.?name/i, /lname/i, /^last$/i],
  full_name: [/full.?name/i, /^name$/i, /your.?name/i, /legal.?name/i, /candidate.?name/i],
  email: [/e.?mail/i, /email.?address/i, /^email$/i],
  phone: [/phone/i, /mobile/i, /cell/i, /tel/i, /contact.?number/i],
  address_line1: [/address.?line.?1/i, /street.?address/i, /^address$/i, /mailing.?address/i],
  address_line2: [/address.?line.?2/i, /apt/i, /suite/i, /unit/i],
  city: [/^city$/i, /city.?name/i, /town/i],
  state: [/^state$/i, /province/i, /region/i],
  zip_code: [/zip/i, /postal/i, /post.?code/i],
  country: [/country/i, /nation/i],
  linkedin_url: [/linkedin/i, /linked.?in/i],
  portfolio_url: [/portfolio/i, /website/i, /personal.?site/i, /blog/i],
  github_url: [/github/i, /git.?hub/i],
  university: [/university/i, /school/i, /college/i, /institution/i, /alma.?mater/i],
  degree: [/degree/i, /education.?level/i, /highest.?degree/i],
  field_of_study: [/field.?of.?study/i, /major/i, /discipline/i, /concentration/i],
  graduation_year: [/graduat/i, /year.?of.?completion/i],
  gpa: [/gpa/i, /grade.?point/i, /cumulative/i],
  years_of_experience: [/years?.?of?.?exp/i, /experience.?years/i, /total.?exp/i],
  current_title: [/current.?title/i, /job.?title/i, /position/i, /role/i, /designation/i],
  current_company: [/current.?company/i, /employer/i, /current.?employer/i, /company.?name/i],
  visa_status: [/visa/i, /immigration/i],
  work_authorization: [/work.?auth/i, /authorized.?to.?work/i, /legal.?right/i, /eligib/i],
  sponsorship_needed: [/sponsor/i, /visa.?sponsor/i, /require.?sponsor/i],
  gender: [/gender/i, /sex/i],
  ethnicity: [/ethnic/i, /race/i, /racial/i],
  veteran_status: [/veteran/i, /military/i, /armed.?forces/i],
  disability_status: [/disabil/i, /handicap/i, /accommodation/i],
  expected_salary: [/salary/i, /compensation/i, /expected.?pay/i, /desired.?salary/i, /pay.?expectation/i],
  current_salary: [/current.?salary/i, /current.?compensation/i, /present.?salary/i],
};

// ---------------------------------------------------------------------------
// Signal extraction from form elements
// ---------------------------------------------------------------------------

function getSignals(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
  const signals: string[] = [];

  // Direct attributes
  if (el.name) signals.push(el.name);
  if (el.id) signals.push(el.id);
  if ("placeholder" in el && el.placeholder) signals.push(el.placeholder);
  if (el.getAttribute("aria-label")) signals.push(el.getAttribute("aria-label")!);
  if (el.getAttribute("autocomplete")) signals.push(el.getAttribute("autocomplete")!);
  if (el.getAttribute("data-testid")) signals.push(el.getAttribute("data-testid")!);

  // Associated label
  const labelText = getAssociatedLabel(el);
  if (labelText) signals.push(labelText);

  // Closest parent with text
  const parent = el.closest("[class*='field'], [class*='form-group'], [class*='input'], label");
  if (parent) {
    const parentText = parent.textContent?.trim().slice(0, 100);
    if (parentText) signals.push(parentText);
  }

  return signals.filter(Boolean);
}

function getAssociatedLabel(el: HTMLElement): string | null {
  // Explicit <label for="...">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  // Wrapping <label>
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) {
    // Remove the input's own value from the label text
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((el) => el.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Field matching
// ---------------------------------------------------------------------------

function matchFieldType(signals: string[]): { fieldType: string; confidence: number } | null {
  let bestMatch: { fieldType: string; confidence: number } | null = null;

  for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const pattern of patterns) {
      for (const signal of signals) {
        if (pattern.test(signal)) {
          // Higher confidence for name/id matches, lower for parent text
          const confidence = signal.length < 50 ? 0.9 : 0.6;
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { fieldType, confidence };
          }
        }
      }
    }
  }

  return bestMatch;
}

function getFieldLabel(el: HTMLElement, signals: string[]): string {
  // Try associated label first
  const label = getAssociatedLabel(el);
  if (label && label.length < 100) return label;

  // Try placeholder
  if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder;

  // Try name/id
  const name = (el as HTMLInputElement).name || el.id;
  if (name) return name.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");

  return "Unknown field";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectFormFields(): DetectedField[] {
  const fields: DetectedField[] = [];
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
  );

  inputs.forEach((el) => {
    // Skip invisible elements
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;

    // Skip already-filled fields (user might have partially filled)
    // We'll still detect them but mark them
    const isFilled = !!(el.value && el.value.trim());

    const signals = getSignals(el);
    const match = matchFieldType(signals);

    // Generate a unique CSS selector for this element
    const selector = generateSelector(el);

    fields.push({
      selector,
      fieldType: match?.fieldType ?? "unknown",
      label: getFieldLabel(el, signals),
      confidence: match?.confidence ?? 0,
      filled: isFilled,
      manual: false,
    });
  });

  // Also detect file upload inputs (for resume/cover letter)
  const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  fileInputs.forEach((el) => {
    const signals = getSignals(el);
    const label = getFieldLabel(el, signals);
    const isResume = /resume|cv|curriculum/i.test(signals.join(" "));
    const isCoverLetter = /cover.?letter/i.test(signals.join(" "));

    fields.push({
      selector: generateSelector(el),
      fieldType: isResume ? "resume_upload" : isCoverLetter ? "cover_letter_upload" : "file_upload",
      label,
      confidence: isResume || isCoverLetter ? 0.8 : 0.3,
      filled: false,
      manual: false,
    });
  });

  return fields;
}

function generateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute("name");
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;

  // Fallback: nth-of-type
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`));
    const index = siblings.indexOf(el);
    if (index >= 0) {
      const parentSelector = parent.id
        ? `#${CSS.escape(parent.id)}`
        : parent.tagName.toLowerCase();
      return `${parentSelector} > ${tag}:nth-of-type(${index + 1})`;
    }
  }

  return tag;
}
