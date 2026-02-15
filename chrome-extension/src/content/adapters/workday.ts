/**
 * Workday adapter (widespread data-automation-id).
 */

import type { PlatformAdapter } from "./types";

export const workdayAdapter: PlatformAdapter = {
  name: "workday",

  detect(): boolean {
    const count = document.querySelectorAll("[data-automation-id]").length;
    return count >= 3;
  },

  getFieldMappings(): Array<{ selector: string; fieldType: string }> {
    const mappings: Array<{ selector: string; fieldType: string }> = [];
    const automationIds: Array<{ id: string; fieldType: string }> = [
      { id: "legalNameSection_firstName", fieldType: "first_name" },
      { id: "legalNameSection_lastName", fieldType: "last_name" },
      { id: "emailAddressSection_email", fieldType: "email" },
      { id: "phoneSection_phone", fieldType: "phone" },
      { id: "addressSection_addressLine1", fieldType: "address_line1" },
      { id: "addressSection_addressLine2", fieldType: "address_line2" },
      { id: "addressSection_city", fieldType: "city" },
      { id: "addressSection_postalCode", fieldType: "zip_code" },
      { id: "addressSection_country", fieldType: "country" },
      { id: "linkedIn", fieldType: "linkedin_url" },
    ];
    for (const { id, fieldType } of automationIds) {
      if (document.querySelector(`[data-automation-id="${id}"]`)) {
        mappings.push({ selector: `[data-automation-id="${id}"]`, fieldType });
      }
    }
    return mappings;
  },

  getNextSelector(): string | null {
    const next = document.querySelector(
      '[data-automation-id="footerButtonContainer-submit"], [data-automation-id*="continue"], button[data-automation-id*="next"]'
    );
    if (next) {
      const aid = (next as HTMLElement).getAttribute("data-automation-id");
      if (aid) return `[data-automation-id="${aid}"]`;
    }
    const buttons = document.querySelectorAll('[data-automation-id*="submit"], [data-automation-id*="next"], [data-automation-id*="continue"]');
    for (const btn of buttons) {
      const text = (btn.textContent || "").toLowerCase();
      if (/continue|next/i.test(text) && !/submit|apply/i.test(text)) {
        const aid = (btn as HTMLElement).getAttribute("data-automation-id");
        if (aid) return `[data-automation-id="${aid}"]`;
      }
    }
    return null;
  },

  getSubmitSelector(): string | null {
    const submit = document.querySelector(
      '[data-automation-id*="submit"], [data-automation-id*="apply"]'
    );
    if (submit) {
      const aid = (submit as HTMLElement).getAttribute("data-automation-id");
      if (aid) return `[data-automation-id="${aid}"]`;
    }
    return null;
  },

  quirks: { extraDelayMs: 300 },
};
