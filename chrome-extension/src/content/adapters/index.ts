/**
 * Platform adapters for known job portals.
 */

import type { PlatformAdapter } from "./types";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { workdayAdapter } from "./workday";

const ADAPTERS: PlatformAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  workdayAdapter,
];

export type { PlatformAdapter } from "./types";

export function detectPlatform(): PlatformAdapter | null {
  for (const adapter of ADAPTERS) {
    if (adapter.detect()) return adapter;
  }
  return null;
}
