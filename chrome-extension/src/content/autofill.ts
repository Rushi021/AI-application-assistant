/**
 * Content script: auto-fill job application forms using user profile data.
 *
 * Injected into all pages. Listens for START_AUTOFILL messages from the
 * side panel, detects form fields, maps them to profile data, fills them
 * sequentially, and pauses with an overlay when a field cannot be matched.
 */

import { MSG, STORAGE_KEYS } from "@/shared/constants";
import type { UserProfile, AutofillProgress, DetectedField } from "@/shared/types";
import { detectFormFields } from "./field-detector";

// ---------------------------------------------------------------------------
// Profile field value resolver
// ---------------------------------------------------------------------------

function resolveValue(fieldType: string, profile: UserProfile): string | null {
  switch (fieldType) {
    case "first_name":
      return profile.full_name?.split(" ")[0] ?? null;
    case "last_name": {
      const parts = profile.full_name?.split(" ");
      return parts && parts.length > 1 ? parts.slice(1).join(" ") : null;
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
    case "github_url":
      return profile.github_url ?? null;
    case "university":
      return profile.university ?? null;
    case "degree":
      return profile.degree ?? null;
    case "field_of_study":
      return profile.field_of_study ?? null;
    case "graduation_year":
      return profile.graduation_year?.toString() ?? null;
    case "gpa":
      return profile.gpa?.toString() ?? null;
    case "years_of_experience":
      return profile.years_of_experience?.toString() ?? null;
    case "current_title":
      return profile.current_title ?? null;
    case "current_company":
      return profile.current_company ?? null;
    case "visa_status":
      return profile.visa_status ?? null;
    case "work_authorization":
      return profile.work_authorization ?? null;
    case "sponsorship_needed":
      return profile.sponsorship_needed === null ? null : profile.sponsorship_needed ? "Yes" : "No";
    case "gender":
      return profile.gender ?? null;
    case "ethnicity":
      return profile.ethnicity ?? null;
    case "veteran_status":
      return profile.veteran_status ?? null;
    case "disability_status":
      return profile.disability_status ?? null;
    case "expected_salary":
      return profile.expected_salary ?? null;
    case "current_salary":
      return profile.current_salary ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// DOM value setter (triggers React/Angular/Vue change detection)
// ---------------------------------------------------------------------------

function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  // For select elements, try to match by value or text
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
    // Use native input value setter to trigger React's onChange
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

  // Dispatch events to trigger framework change detection
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Overlay (Shadow DOM - paused alert with manual fill checkbox)
// ---------------------------------------------------------------------------

let overlayHost: HTMLDivElement | null = null;

function showPauseOverlay(
  fieldElement: Element,
  fieldLabel: string,
  onManualFill: () => void,
  onSkip: () => void
): void {
  removePauseOverlay();

  overlayHost = document.createElement("div");
  overlayHost.id = "ai-assistant-overlay-host";
  document.body.appendChild(overlayHost);

  const shadow = overlayHost.attachShadow({ mode: "closed" });

  const styles = document.createElement("style");
  styles.textContent = `
    .overlay-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.15);
      z-index: 2147483646;
    }
    .overlay-card {
      position: fixed;
      z-index: 2147483647;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
      padding: 16px;
      width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .overlay-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .overlay-icon {
      width: 24px;
      height: 24px;
      background: #FEF3C7;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .overlay-title-text {
      font-size: 14px;
      font-weight: 600;
      color: #1F2937;
    }
    .overlay-field-name {
      font-size: 12px;
      color: #6B7280;
      margin-bottom: 12px;
      padding: 6px 10px;
      background: #F9FAFB;
      border-radius: 6px;
      border: 1px solid #E5E7EB;
    }
    .overlay-checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
    }
    .overlay-checkbox {
      width: 18px;
      height: 18px;
      accent-color: #F97316;
      cursor: pointer;
    }
    .overlay-checkbox-label {
      font-size: 13px;
      color: #374151;
      cursor: pointer;
    }
    .overlay-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .overlay-btn {
      flex: 1;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: background 0.15s;
    }
    .overlay-btn-skip {
      background: #F3F4F6;
      color: #6B7280;
    }
    .overlay-btn-skip:hover {
      background: #E5E7EB;
    }
    .overlay-btn-continue {
      background: #F97316;
      color: white;
      opacity: 0.5;
      cursor: not-allowed;
    }
    .overlay-btn-continue.enabled {
      opacity: 1;
      cursor: pointer;
    }
    .overlay-btn-continue.enabled:hover {
      background: #EA580C;
    }
    .field-highlight {
      outline: 3px solid #F97316 !important;
      outline-offset: 2px;
      box-shadow: 0 0 0 6px rgba(249,115,22,0.15) !important;
    }
  `;

  // Position card near the field
  const rect = fieldElement.getBoundingClientRect();
  const cardTop = Math.min(rect.bottom + 8, window.innerHeight - 220);
  const cardLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 340));

  const card = document.createElement("div");
  card.className = "overlay-card";
  card.style.top = `${cardTop}px`;
  card.style.left = `${cardLeft}px`;

  card.innerHTML = `
    <div class="overlay-title">
      <div class="overlay-icon">&#9888;</div>
      <div class="overlay-title-text">Auto-fill Paused</div>
    </div>
    <div class="overlay-field-name">
      Could not determine value for: <strong>${escapeHtml(fieldLabel)}</strong>
    </div>
    <div class="overlay-checkbox-row">
      <input type="checkbox" class="overlay-checkbox" id="ai-manual-check" />
      <label class="overlay-checkbox-label" for="ai-manual-check">
        I have filled this field manually
      </label>
    </div>
    <div class="overlay-actions">
      <button class="overlay-btn overlay-btn-skip" id="ai-skip-btn">Skip</button>
      <button class="overlay-btn overlay-btn-continue" id="ai-continue-btn">Continue</button>
    </div>
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "overlay-backdrop";

  shadow.appendChild(styles);
  shadow.appendChild(backdrop);
  shadow.appendChild(card);

  // Highlight the field
  fieldElement.classList.add("field-highlight");

  // Wire up events
  const checkbox = shadow.getElementById("ai-manual-check") as HTMLInputElement;
  const continueBtn = shadow.getElementById("ai-continue-btn") as HTMLButtonElement;
  const skipBtn = shadow.getElementById("ai-skip-btn") as HTMLButtonElement;

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      continueBtn.classList.add("enabled");
    } else {
      continueBtn.classList.remove("enabled");
    }
  });

  continueBtn.addEventListener("click", () => {
    if (!checkbox.checked) return;
    fieldElement.classList.remove("field-highlight");
    removePauseOverlay();
    onManualFill();
  });

  skipBtn.addEventListener("click", () => {
    fieldElement.classList.remove("field-highlight");
    removePauseOverlay();
    onSkip();
  });

  // Scroll field into view
  fieldElement.scrollIntoView({ behavior: "smooth", block: "center" });
}

function removePauseOverlay() {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
  }
  // Remove any lingering highlights
  document.querySelectorAll(".field-highlight").forEach((el) => {
    el.classList.remove("field-highlight");
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Main autofill orchestrator
// ---------------------------------------------------------------------------

async function runAutofill(profile: UserProfile): Promise<void> {
  const fields = detectFormFields();

  const progress: AutofillProgress = {
    total: fields.length,
    filled: 0,
    manual: 0,
    skipped: 0,
    currentField: null,
    paused: false,
    completed: false,
  };

  // Report initial progress
  sendProgress(progress);

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    // Skip file uploads for now (handled separately)
    if (field.fieldType.includes("upload")) continue;

    // Skip already-filled fields
    if (field.filled) {
      progress.filled++;
      continue;
    }

    progress.currentField = field.label;
    sendProgress(progress);

    const el = document.querySelector(field.selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) {
      progress.skipped++;
      continue;
    }

    const value = field.confidence >= 0.5 ? resolveValue(field.fieldType, profile) : null;

    if (value) {
      // Fill the field
      setFieldValue(el, value);
      field.filled = true;
      progress.filled++;
      sendProgress(progress);

      // Small delay between fields for visual feedback + framework processing
      await sleep(150);
    } else {
      // Cannot match — pause and show overlay
      progress.paused = true;
      sendProgress(progress);

      const result = await new Promise<"manual" | "skip">((resolve) => {
        showPauseOverlay(
          el,
          field.label,
          () => resolve("manual"),
          () => resolve("skip")
        );
      });

      progress.paused = false;

      if (result === "manual") {
        field.manual = true;
        progress.manual++;
      } else {
        progress.skipped++;
      }
      sendProgress(progress);
    }
  }

  progress.currentField = null;
  progress.completed = true;
  sendProgress(progress);
}

function sendProgress(progress: AutofillProgress) {
  chrome.runtime.sendMessage({
    type: MSG.AUTOFILL_PROGRESS,
    data: { ...progress },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG.START_AUTOFILL) {
    // Get profile from storage
    chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE], (result) => {
      const profile = result[STORAGE_KEYS.USER_PROFILE] as UserProfile | undefined;
      if (!profile) {
        sendResponse({ error: "No user profile found" });
        return;
      }
      runAutofill(profile).then(() => {
        sendResponse({ success: true });
      });
    });
    return true; // async
  }

  if (message.type === MSG.DETECT_JOB_DESCRIPTION) {
    // Try to detect JD text from page
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
