/**
 * Single-slot layout persistence in localStorage. Phase 7-lite — one
 * "default" slot, no UI for managing multiple layouts. The full Layouts
 * panel arrives in Phase 7.
 *
 * Schema is versioned so a future upgrade can refuse to load an
 * incompatible blob with a clear error rather than silently corrupting
 * editor state. Image elements include their full `dataUrl` (base64);
 * a single 800×480 photo is typically tens of KB compressed, well
 * under the ~5 MB localStorage quota for one slot.
 */

import type { Element } from "./types";

export const LAYOUT_SCHEMA_VERSION = 1;
const STORAGE_KEY = "clapboard.layout.default";

export interface LayoutBlobV1 {
  schemaVersion: 1;
  savedAt: number;
  elements: Element[];
}

export type LayoutBlob = LayoutBlobV1;

export class LayoutSchemaError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LayoutSchemaError";
  }
}

export function serializeLayout(elements: Element[]): LayoutBlob {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    savedAt: Date.now(),
    elements,
  };
}

export function parseLayout(raw: string): LayoutBlob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LayoutSchemaError("layout blob is not valid JSON", err);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new LayoutSchemaError("layout blob is not an object");
  }
  const { schemaVersion, elements } = parsed as Partial<LayoutBlob>;
  if (schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw new LayoutSchemaError(
      `unsupported schema version ${schemaVersion} (expected ${LAYOUT_SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(elements)) {
    throw new LayoutSchemaError("layout blob has no elements array");
  }
  return parsed as LayoutBlob;
}

export function saveDefaultLayout(elements: Element[]): void {
  if (typeof localStorage === "undefined") return;
  const blob = serializeLayout(elements);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

export function loadDefaultLayout(): LayoutBlob | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return parseLayout(raw);
}

export function clearDefaultLayout(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasDefaultLayout(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}
