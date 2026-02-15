/**
 * Site learning: store and lookup user-confirmed field mappings.
 * Platform-level and domain-level storage.
 */

import { STORAGE_KEYS } from "@/shared/constants";
import { detectPlatform } from "./adapters";

export interface FieldMapping {
  selector: string;
  labelNorm: string;
  fieldType: string;
  confirmations: number;
}

export interface FieldMappingsStorage {
  byPlatform: Record<string, FieldMapping[]>;
  byDomain: Record<string, FieldMapping[]>;
}

const DEFAULT: FieldMappingsStorage = {
  byPlatform: {},
  byDomain: {},
};

function getPlatformName(): string | null {
  const adapter = detectPlatform();
  return adapter?.name ?? null;
}

function getDomain(): string {
  try {
    return new URL(window.location.href).hostname;
  } catch {
    return "";
  }
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadMappings(): Promise<FieldMappingsStorage> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FIELD_MAPPINGS);
  const stored = result[STORAGE_KEYS.FIELD_MAPPINGS];
  if (!stored || typeof stored !== "object") return { ...DEFAULT };
  return {
    byPlatform: (stored as FieldMappingsStorage).byPlatform ?? {},
    byDomain: (stored as FieldMappingsStorage).byDomain ?? {},
  };
}

export async function saveMappings(data: FieldMappingsStorage): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.FIELD_MAPPINGS]: data });
}

export async function lookupLearnedMapping(
  selector: string,
  labelNorm: string
): Promise<{ fieldType: string; confirmations: number } | null> {
  const mappings = await loadMappings();
  const platform = getPlatformName();
  const domain = getDomain();

  if (platform && mappings.byPlatform[platform]) {
    const m = mappings.byPlatform[platform].find(
      (x) => x.selector === selector || x.labelNorm === labelNorm
    );
    if (m && m.confirmations >= 2) return { fieldType: m.fieldType, confirmations: m.confirmations };
  }

  if (domain && mappings.byDomain[domain]) {
    const m = mappings.byDomain[domain].find(
      (x) => x.selector === selector || x.labelNorm === labelNorm
    );
    if (m && m.confirmations >= 2) return { fieldType: m.fieldType, confirmations: m.confirmations };
  }

  return null;
}

export async function saveLearnedMapping(
  selector: string,
  labelNorm: string,
  fieldType: string
): Promise<void> {
  const mappings = await loadMappings();
  const platform = getPlatformName();
  const domain = getDomain();

  const addOrUpdate = (bucket: Record<string, FieldMapping[]>, key: string) => {
    if (!bucket[key]) bucket[key] = [];
    const idx = bucket[key].findIndex(
      (x) => x.selector === selector || x.labelNorm === labelNorm
    );
    const entry: FieldMapping = {
      selector,
      labelNorm,
      fieldType,
      confirmations: idx >= 0 ? bucket[key][idx].confirmations + 1 : 1,
    };
    if (idx >= 0) {
      bucket[key][idx] = entry;
    } else {
      bucket[key].push(entry);
    }
  };

  if (platform) addOrUpdate(mappings.byPlatform, platform);
  if (domain) addOrUpdate(mappings.byDomain, domain);

  await saveMappings(mappings);
}

export { normalizeLabel };
