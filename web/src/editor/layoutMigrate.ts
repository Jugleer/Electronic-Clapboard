/**
 * One-shot migrator from the legacy localStorage layout backends
 * (v1 single slot, v2 three-slot blob) into the Phase-7 IndexedDB
 * v3 store. Idempotent: if the localStorage keys are already gone,
 * `migrateLegacyLayouts()` does nothing. If they're present, it
 * imports each occupied slot as a separate v3 layout and removes
 * the legacy keys so a later call is a no-op.
 *
 * Runs once at app startup before the layout picker hits the IDB
 * store. We don't hold up rendering on it — the picker re-lists
 * after migration completes.
 */

import {
  migrateElements,
  type LayoutRecord,
} from "./layoutSchema";
import { saveLayout } from "./layoutStore";
import { type Element } from "./types";

const LEGACY_V2_KEY = "clapboard.layout.slots";
const LEGACY_V1_KEY = "clapboard.layout.default";

interface LegacyV2Slot {
  name: string;
  savedAt: number;
  elements: Element[];
  thumbnail: string | null;
}

interface LegacyV2Blob {
  schemaVersion: 2;
  slots: (LegacyV2Slot | null)[];
}

interface LegacyV1Blob {
  schemaVersion?: 1;
  savedAt?: number;
  elements: Element[];
}

export interface MigrationResult {
  migrated: LayoutRecord[];
  /** Already-migrated runs return an empty array and `skipped: true`. */
  skipped: boolean;
}

function readLegacyV2(): LegacyV2Blob | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_V2_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyV2Blob>;
    if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.slots)) return null;
    return parsed as LegacyV2Blob;
  } catch {
    return null;
  }
}

function readLegacyV1(): LegacyV1Blob | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_V1_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyV1Blob>;
    if (!parsed || !Array.isArray(parsed.elements)) return null;
    return parsed as LegacyV1Blob;
  } catch {
    return null;
  }
}

function dropLegacyKeys(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_V2_KEY);
  } catch {
    // best-effort
  }
  try {
    localStorage.removeItem(LEGACY_V1_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Run the localStorage→IDB migration. Safe to call on every app
 * startup; no-op once the legacy keys are gone.
 *
 * Strategy: prefer v2 if present (it's the most recent format).
 * Otherwise check for v1 and import its single slot as one v3
 * layout. Element-field migration runs through `migrateElements`
 * so a Phase-5 layout's image elements pick up `algorithm:
 * "threshold"` and the brightness/contrast defaults.
 */
export async function migrateLegacyLayouts(): Promise<MigrationResult> {
  if (typeof localStorage === "undefined") {
    return { migrated: [], skipped: true };
  }

  const v2 = readLegacyV2();
  const v1 = readLegacyV1();
  if (!v2 && !v1) {
    return { migrated: [], skipped: true };
  }

  const migrated: LayoutRecord[] = [];

  if (v2) {
    // Each occupied slot becomes its own v3 layout. Empty slots
    // disappear — Phase 7's "unbounded named layouts" model has
    // no concept of an empty placeholder.
    for (const slot of v2.slots) {
      if (!slot || !Array.isArray(slot.elements)) continue;
      const record = await saveLayout({
        name: slot.name?.trim() || "Imported",
        elements: migrateElements(slot.elements),
        thumbnail: typeof slot.thumbnail === "string" ? slot.thumbnail : null,
      });
      migrated.push(record);
    }
  } else if (v1) {
    const record = await saveLayout({
      name: "Default",
      elements: migrateElements(v1.elements),
      thumbnail: null,
    });
    migrated.push(record);
  }

  dropLegacyKeys();

  return { migrated, skipped: false };
}
