/**
 * Greenhouse (boards.greenhouse.io) adapter.
 */

import type { PlatformAdapter } from "./types";

export const greenhouseAdapter: PlatformAdapter = {
  name: "greenhouse",

  detect(): boolean {
    if (typeof window === "undefined" || !window.location) return false;
    const url = window.location.href;
    return (
      url.includes("boards.greenhouse.io") ||
      !!document.querySelector("#application_form")
    );
  },

  getFieldMappings(): Array<{ selector: string; fieldType: string }> {
    return [
      { selector: 'input[name="job_application[first_name]"]', fieldType: "first_name" },
      { selector: 'input[name="job_application[last_name]"]', fieldType: "last_name" },
      { selector: 'input[name="job_application[email]"]', fieldType: "email" },
      { selector: 'input[name="job_application[phone]"]', fieldType: "phone" },
      { selector: 'input[name="job_application[address]"]', fieldType: "address_line1" },
      { selector: 'input[name="job_application[city]"]', fieldType: "city" },
      { selector: 'input[name="job_application[state]"]', fieldType: "state" },
      { selector: 'input[name="job_application[zip_code]"]', fieldType: "zip_code" },
      { selector: 'input[name="job_application[country]"]', fieldType: "country" },
      { selector: 'input[name="job_application[linkedin_url]"]', fieldType: "linkedin_url" },
      { selector: 'input[name="job_application[website]"]', fieldType: "portfolio_url" },
      { selector: 'input[id="job_application_first_name"]', fieldType: "first_name" },
      { selector: 'input[id="job_application_last_name"]', fieldType: "last_name" },
      { selector: 'input[id="job_application_email"]', fieldType: "email" },
      { selector: 'input[id="job_application_phone"]', fieldType: "phone" },
    ];
  },

  getNextSelector(): string | null {
    const buttons = document.querySelectorAll(
      'input[type="submit"], button[type="submit"], a[class*="button"]'
    );
    for (const btn of buttons) {
      const text = (btn.textContent || (btn as HTMLInputElement).value || "").toLowerCase();
      if (/continue|next|save and continue/i.test(text)) {
        const sel = btn.id ? `#${CSS.escape(btn.id)}` : null;
        if (sel) return sel;
      }
    }
    return null;
  },

  getSubmitSelector(): string | null {
    const submit = document.querySelector(
      'input[type="submit"][value*="Submit"], input[type="submit"][value*="Apply"], button[type="submit"]'
    );
    if (submit?.id) return `#${CSS.escape(submit.id)}`;
    return null;
  },
};
