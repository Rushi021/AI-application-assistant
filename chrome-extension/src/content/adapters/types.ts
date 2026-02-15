/**
 * Platform adapter interface.
 */

export interface PlatformAdapter {
  name: string;
  detect(): boolean;
  getFieldMappings(): Array<{ selector: string; fieldType: string }>;
  getNextSelector(): string | null;
  getSubmitSelector(): string | null;
  quirks?: { extraDelayMs?: number };
  getCustomDropdownSelectors?(): Array<{
    triggerSelector: string;
    optionsSelector: string;
  }>;
}
