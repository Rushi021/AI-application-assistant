/**
 * Lever (jobs.lever.co) adapter.
 */

import type { PlatformAdapter } from "./types";

export const leverAdapter: PlatformAdapter = {
  name: "lever",

  detect(): boolean {
    if (typeof window === "undefined" || !window.location) return false;
    return window.location.href.includes("jobs.lever.co");
  },

  getFieldMappings(): Array<{ selector: string; fieldType: string }> {
    return [
      { selector: 'input[name="name"]', fieldType: "full_name" },
      { selector: 'input[name="email"]', fieldType: "email" },
      { selector: 'input[name="phone"]', fieldType: "phone" },
      { selector: 'input[data-qa="name-input"]', fieldType: "full_name" },
      { selector: 'input[data-qa="email-input"]', fieldType: "email" },
      { selector: 'input[data-qa="phone-input"]', fieldType: "phone" },
      { selector: 'input[placeholder*="Name"]', fieldType: "full_name" },
      { selector: 'input[placeholder*="Email"]', fieldType: "email" },
      { selector: 'input[placeholder*="Phone"]', fieldType: "phone" },
      { selector: 'input[id*="name"]', fieldType: "full_name" },
      { selector: 'input[id*="email"]', fieldType: "email" },
      { selector: 'input[id*="phone"]', fieldType: "phone" },
      { selector: 'input[type="email"]', fieldType: "email" },
      { selector: 'input[type="tel"]', fieldType: "phone" },
    ];
  },

  getNextSelector(): string | null {
    const all = document.querySelectorAll('button, a[class*="button"]');
    for (const el of all) {
      const text = (el.textContent || "").toLowerCase();
      if (/continue|next/i.test(text)) {
        const id = (el as HTMLElement).id;
        if (id) return `#${CSS.escape(id)}`;
      }
    }
    return null;
  },

  getSubmitSelector(): string | null {
    const all = document.querySelectorAll('button, input[type="submit"], a[class*="button"]');
    for (const el of all) {
      const text = (el.textContent || (el as HTMLInputElement).value || "").toLowerCase();
      if (/submit|apply/i.test(text)) {
        const id = (el as HTMLElement).id;
        if (id) return `#${CSS.escape(id)}`;
      }
    }
    return null;
  },
};
