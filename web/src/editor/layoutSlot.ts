/**
 * Three named layout slots in localStorage. Phase 7-lite: still
 * single-window, no IndexedDB, no JSON export — but the user can keep
 * a few distinct setups (a sit-com slate, a doc slate, a stunt slate)
 * and switch between them in one click. Each slot stores a thumbnail
 * PNG dataURL so the picker can render a hover preview without
 * decoding image elements on every render.
 *
 * Schema v2 (current):
 *   { schemaVersion: 2, slots: SlotV2[3] }
 *   SlotV2: { name, savedAt, elements, thumbnail } | null
 *
 * Schema v1 (legacy single slot under `clapboard.layout.default`) is
 * silently migrated into slot 0 the first time the v2 reader runs.
 *
 * Quota: localStorage caps at ~5 MB per origin. Three slots × one
 * 800×480 image element ≈ comfortably inside, but a slot with several
 * heavy photos will tip it. `saveSlot` catches `QuotaExceededError`
 * and surfaces it to the caller so the UI can show "storage full,
 * clear a slot or delete uploads".
 */

import type { Element } from "./types";

export const LAYOUT_SCHEMA_VERSION = 2;
export const SLOT_COUNT = 3;
const STORAGE_KEY = "clapboard.layout.slots";
const LEGACY_KEY = "clapboard.layout.default";

export interface LayoutSlot {
  name: string;
  savedAt: number;
  elements: Element[];
  /** PNG dataURL of a small thumbnail (≤ 200 px wide). */
  thumbnail: string | null;
}

export interface LayoutBlobV2 {
  schemaVersion: 2;
  slots: (LayoutSlot | null)[];
}

export class LayoutSchemaError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LayoutSchemaError";
  }
}

export class LayoutQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutQuotaError";
  }
}

function emptyBlob(): LayoutBlobV2 {
  return {
    schemaVersion: 2,
    slots: Array.from({ length: SLOT_COUNT }, () => null),
  };
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /quota|storage/i.test(err.name) || /quota/i.test(err.message);
}

function readRaw(): LayoutBlobV2 {
  if (typeof localStorage === "undefined") return emptyBlob();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    return parseBlob(raw);
  }
  // Migrate legacy single-slot v1 if present.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const v1 = JSON.parse(legacy) as { elements?: Element[] };
      if (v1 && Array.isArray(v1.elements)) {
        const blob = emptyBlob();
        blob.slots[0] = {
          name: "Default",
          savedAt: Date.now(),
          elements: v1.elements,
          thumbnail: null,
        };
        // Best-effort: persist the migration so the legacy key can go.
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
          localStorage.removeItem(LEGACY_KEY);
        } catch {
          // If the migration write fails (quota), keep the legacy key
          // around — losing the slot silently would be worse.
        }
        return blob;
      }
    } catch {
      // Silently drop a malformed legacy blob — there's nothing
      // recoverable in it for the user.
    }
  }
  return emptyBlob();
}

export function parseBlob(raw: string): LayoutBlobV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LayoutSchemaError("layout blob is not valid JSON", err);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new LayoutSchemaError("layout blob is not an object");
  }
  const obj = parsed as Partial<LayoutBlobV2>;
  if (obj.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw new LayoutSchemaError(
      `unsupported schema version ${obj.schemaVersion} (expected ${LAYOUT_SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(obj.slots) || obj.slots.length !== SLOT_COUNT) {
    throw new LayoutSchemaError(
      `slots array has wrong length (expected ${SLOT_COUNT})`,
    );
  }
  return parsed as LayoutBlobV2;
}

function writeRaw(blob: LayoutBlobV2): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch (err) {
    if (isQuotaError(err)) {
      throw new LayoutQuotaError(
        "browser storage is full — clear a slot or remove uploaded images",
      );
    }
    throw err;
  }
}

export function listSlots(): (LayoutSlot | null)[] {
  return readRaw().slots;
}

export function saveSlot(
  index: number,
  name: string,
  elements: Element[],
  thumbnail: string | null,
): void {
  if (index < 0 || index >= SLOT_COUNT) {
    throw new RangeError(`slot index ${index} out of range`);
  }
  const blob = readRaw();
  blob.slots[index] = {
    name: name.trim() || `Slot ${index + 1}`,
    savedAt: Date.now(),
    elements,
    thumbnail,
  };
  writeRaw(blob);
}

export function loadSlot(index: number): LayoutSlot | null {
  const blob = readRaw();
  if (index < 0 || index >= SLOT_COUNT) return null;
  return blob.slots[index] ?? null;
}

export function clearSlot(index: number): void {
  if (index < 0 || index >= SLOT_COUNT) return;
  const blob = readRaw();
  blob.slots[index] = null;
  writeRaw(blob);
}

export function renameSlot(index: number, name: string): void {
  const blob = readRaw();
  const existing = blob.slots[index];
  if (!existing) return;
  existing.name = name.trim() || `Slot ${index + 1}`;
  writeRaw(blob);
}
