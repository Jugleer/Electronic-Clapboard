/**
 * Pure schema/validation helpers for saved layouts. Phase 7 split this
 * out of the old `layoutSlot.ts` so the IndexedDB store, the
 * localStorage→IDB migrator, and the JSON export/import path can share
 * one validator without dragging the storage backend into pure-logic
 * tests.
 *
 * Schema timeline:
 *   v1 (legacy) — single slot under `clapboard.layout.default`,
 *                 `{ schemaVersion: 1, savedAt, elements }`.
 *   v2 (Phase 5) — three fixed slots under `clapboard.layout.slots`,
 *                 `{ schemaVersion: 2, slots: SlotV2[3] }`.
 *   v3 (Phase 7) — unbounded named layouts in IndexedDB. The on-disk
 *                  unit is a single layout, exported as
 *                  `{ schemaVersion: 3, id, name, savedAt, elements,
 *                     thumbnail }`. The localStorage v2 blob is
 *                  one-shot migrated into v3 entries on first read
 *                  (see `layoutMigrate.ts`).
 *
 * The Phase-6 ImageElement field migration (`algorithm`, `brightness`,
 * `contrast`) lives here as `migrateElement` and runs on every load
 * regardless of source version. Legacy elements default to
 * `algorithm: "threshold"` so their pre-Phase-6 appearance is
 * preserved; fresh `defaultsFor` uploads pick FS instead.
 */

import {
  DEFAULT_IMAGE_BRIGHTNESS,
  DEFAULT_IMAGE_CONTRAST,
  type Element,
  type ImageElement,
} from "./types";

export const LAYOUT_SCHEMA_VERSION = 3;

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

/**
 * One named layout. The persisted unit in v3.
 *
 * `id` is a stable opaque identifier (uuid-ish); the user never sees
 * it. `name` is what the picker renders. `thumbnail` is a small
 * PNG dataURL used by the hover preview — null is fine.
 */
export interface LayoutRecord {
  schemaVersion: 3;
  id: string;
  name: string;
  savedAt: number;
  elements: Element[];
  thumbnail: string | null;
}

/**
 * Lightweight index entry — what the picker needs to render the list
 * without paying to decode every layout's elements + thumbnail data.
 */
export interface LayoutSummary {
  id: string;
  name: string;
  savedAt: number;
  thumbnail: string | null;
}

export function summaryOf(record: LayoutRecord): LayoutSummary {
  return {
    id: record.id,
    name: record.name,
    savedAt: record.savedAt,
    thumbnail: record.thumbnail,
  };
}

/**
 * Patch missing image-element fields added in Phase 6. Pre-Phase-6
 * `ImageElement`s default to `algorithm: "threshold"` so their
 * appearance doesn't shift on load; fresh elements made via
 * `defaultsFor` use FS (the better default for new uploads).
 */
export function migrateElement(el: Element): Element {
  if (el.type !== "image") return el;
  const partial = el as Partial<ImageElement> & Element;
  if (
    partial.algorithm !== undefined &&
    partial.brightness !== undefined &&
    partial.contrast !== undefined
  ) {
    return el;
  }
  return {
    ...el,
    algorithm: partial.algorithm ?? "threshold",
    brightness: partial.brightness ?? DEFAULT_IMAGE_BRIGHTNESS,
    contrast: partial.contrast ?? DEFAULT_IMAGE_CONTRAST,
  };
}

export function migrateElements(elements: Element[]): Element[] {
  return elements.map(migrateElement);
}

/**
 * Parse a serialised v3 layout (e.g. an exported JSON file) and run
 * the Phase-6 element-field migration. Throws `LayoutSchemaError`
 * with a user-readable message on any structural problem so the
 * import UI can surface it directly.
 */
export function parseLayoutRecord(raw: string): LayoutRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LayoutSchemaError("layout file is not valid JSON", err);
  }
  return validateLayoutRecord(parsed);
}

export function validateLayoutRecord(input: unknown): LayoutRecord {
  if (!input || typeof input !== "object") {
    throw new LayoutSchemaError("layout is not an object");
  }
  const obj = input as Partial<LayoutRecord>;
  if (obj.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw new LayoutSchemaError(
      `unsupported schema version ${obj.schemaVersion} (expected ${LAYOUT_SCHEMA_VERSION}). ` +
        `Re-export from a newer build, or upgrade this editor.`,
    );
  }
  if (typeof obj.id !== "string" || !obj.id) {
    throw new LayoutSchemaError("layout is missing an id");
  }
  if (typeof obj.name !== "string") {
    throw new LayoutSchemaError("layout is missing a name");
  }
  if (typeof obj.savedAt !== "number" || !Number.isFinite(obj.savedAt)) {
    throw new LayoutSchemaError("layout savedAt is not a number");
  }
  if (!Array.isArray(obj.elements)) {
    throw new LayoutSchemaError("layout elements is not an array");
  }
  const thumbnail =
    typeof obj.thumbnail === "string" || obj.thumbnail === null
      ? obj.thumbnail
      : null;
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    id: obj.id,
    name: obj.name,
    savedAt: obj.savedAt,
    elements: migrateElements(obj.elements),
    thumbnail,
  };
}

/**
 * Sanitise a layout name for use in an export filename. Lowercases,
 * collapses whitespace and unsafe characters into single dashes,
 * trims leading/trailing dashes. Empty input falls back to "slate"
 * so the filename is always non-empty.
 */
export function filenameSafeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "slate";
}

/**
 * Produce a `slate-<name>-<YYYYMMDD>.json` filename for export.
 * The date component lets users sort by chronology in their file
 * browser without opening anything.
 */
export function exportFilename(name: string, savedAt: number): string {
  const d = new Date(savedAt);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `slate-${filenameSafeName(name)}-${yyyy}${mm}${dd}.json`;
}

/**
 * Generate an opaque unique id for a new layout. Prefer the platform
 * `crypto.randomUUID()` when available, fall back to a Math.random
 * id for environments (older jsdom) that don't expose it. Either
 * shape is treated as opaque — never parsed.
 */
export function newLayoutId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `lay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
