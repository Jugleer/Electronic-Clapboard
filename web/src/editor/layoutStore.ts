/**
 * IndexedDB-backed layout store. One DB-keyval entry per layout
 * (keyed by uuid), plus a single `__index` entry holding the
 * `LayoutSummary` array so the picker can render the list without
 * paying to deserialise every layout's elements + thumbnail. The
 * index is reconciled on read against the actual key set, so a
 * partial write (browser killed mid-`saveLayout`) self-heals on
 * the next list call.
 *
 * Why per-layout entries instead of one giant blob:
 *   - rename / delete don't touch the other layouts;
 *   - per-value size limits stay polite even with image-heavy
 *     slates (a 1080p photo is ~3 MB base64 — fine in IDB,
 *     punishing if 20 of them share one keyval entry);
 *   - JSON export / import works on a single layout at a time
 *     without needing a "which slot" picker.
 *
 * idb-keyval is async-only; everything here returns a Promise.
 */

import {
  clear as idbClear,
  createStore,
  del as idbDel,
  get as idbGet,
  keys as idbKeys,
  set as idbSet,
  type UseStore,
} from "idb-keyval";

import {
  exportFilename,
  LayoutQuotaError,
  LayoutSchemaError,
  LAYOUT_SCHEMA_VERSION,
  type LayoutRecord,
  type LayoutSummary,
  migrateElements,
  newLayoutId,
  parseLayoutRecord,
  summaryOf,
  validateLayoutRecord,
} from "./layoutSchema";
import { type Element } from "./types";

const DB_NAME = "clapboard-layouts";
const STORE_NAME = "layouts";
const INDEX_KEY = "__index";

let activeStore: UseStore | null = null;

function store(): UseStore {
  if (!activeStore) {
    activeStore = createStore(DB_NAME, STORE_NAME);
  }
  return activeStore;
}

/** Test-only: drop the cached store handle so a fresh DB picks up. */
export function _resetStoreForTests(): void {
  activeStore = null;
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /quota|storage/i.test(err.name) || /quota/i.test(err.message);
}

async function withQuotaGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isQuotaError(err)) {
      throw new LayoutQuotaError(
        "browser storage is full — delete a layout or remove uploaded images",
      );
    }
    throw err;
  }
}

async function readIndexRaw(): Promise<LayoutSummary[]> {
  const raw = await idbGet(INDEX_KEY, store());
  if (!Array.isArray(raw)) return [];
  // Defensive: filter only entries shaped like a summary so a
  // partially-corrupt index doesn't crash the picker.
  return raw.filter(
    (e): e is LayoutSummary =>
      !!e &&
      typeof e === "object" &&
      typeof (e as LayoutSummary).id === "string" &&
      typeof (e as LayoutSummary).name === "string" &&
      typeof (e as LayoutSummary).savedAt === "number",
  );
}

async function writeIndex(entries: LayoutSummary[]): Promise<void> {
  await idbSet(INDEX_KEY, entries, store());
}

/**
 * Reconcile the index against the actual key set. Drops index
 * entries whose layouts went missing (e.g. half-completed delete)
 * and adds bare entries for orphan layouts (e.g. half-completed
 * save). Cheap — runs on every list call.
 */
async function reconciledIndex(): Promise<LayoutSummary[]> {
  const [index, allKeys] = await Promise.all([
    readIndexRaw(),
    idbKeys(store()),
  ]);
  const layoutKeys = new Set(
    allKeys.filter((k): k is string => typeof k === "string" && k !== INDEX_KEY),
  );
  const survivors = index.filter((e) => layoutKeys.has(e.id));
  const indexedIds = new Set(survivors.map((e) => e.id));
  const orphanIds = [...layoutKeys].filter((k) => !indexedIds.has(k));

  if (orphanIds.length > 0) {
    // Hydrate orphan layouts to recover their summary fields.
    const orphans = await Promise.all(
      orphanIds.map(async (id) => {
        const rec = (await idbGet(id, store())) as LayoutRecord | undefined;
        if (!rec) return null;
        try {
          const validated = validateLayoutRecord(rec);
          return summaryOf(validated);
        } catch {
          return null;
        }
      }),
    );
    for (const o of orphans) if (o) survivors.push(o);
  }

  // Persist the reconciled index if it differs in length (cheap
  // proxy — we only care that a future list call doesn't pay the
  // reconcile cost again unnecessarily).
  if (survivors.length !== index.length) {
    try {
      await writeIndex(survivors);
    } catch {
      // best-effort; the index is rebuildable on every read
    }
  }

  return survivors;
}

/**
 * List all saved layouts, newest first by `savedAt`. Cheap — only
 * touches the index entry plus a key listing. Hydrating elements
 * still requires a `loadLayout` call.
 */
export async function listLayouts(): Promise<LayoutSummary[]> {
  const entries = await reconciledIndex();
  return entries.slice().sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadLayout(id: string): Promise<LayoutRecord | null> {
  const raw = await idbGet(id, store());
  if (!raw) return null;
  const record = validateLayoutRecord(raw);
  return {
    ...record,
    elements: migrateElements(record.elements),
  };
}

export interface SaveLayoutInput {
  /** Existing layout id to overwrite, or omit to create a new one. */
  id?: string;
  name: string;
  elements: Element[];
  thumbnail: string | null;
}

/**
 * Persist a layout. With `id` omitted, creates a new entry. With
 * `id` provided, overwrites the matching entry; if no entry has
 * that id this still creates one (so the call is idempotent across
 * lost-then-restored layouts).
 *
 * Returns the saved record so callers can pick up `id` and
 * `savedAt` without a follow-up read.
 */
export async function saveLayout(input: SaveLayoutInput): Promise<LayoutRecord> {
  const trimmed = input.name.trim();
  const record: LayoutRecord = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    id: input.id ?? newLayoutId(),
    name: trimmed || "Untitled",
    savedAt: Date.now(),
    elements: input.elements,
    thumbnail: input.thumbnail,
  };

  await withQuotaGuard(async () => {
    await idbSet(record.id, record, store());
    const index = await readIndexRaw();
    const next = index.filter((e) => e.id !== record.id);
    next.push(summaryOf(record));
    await writeIndex(next);
  });

  return record;
}

export async function renameLayout(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LayoutSchemaError("name cannot be empty");
  }
  const raw = await idbGet(id, store());
  if (!raw) return;
  const record = validateLayoutRecord(raw);
  const updated: LayoutRecord = { ...record, name: trimmed };
  await withQuotaGuard(async () => {
    await idbSet(id, updated, store());
    const index = await readIndexRaw();
    const next = index.map((e) => (e.id === id ? { ...e, name: trimmed } : e));
    await writeIndex(next);
  });
}

export async function deleteLayout(id: string): Promise<void> {
  await idbDel(id, store());
  const index = await readIndexRaw();
  await writeIndex(index.filter((e) => e.id !== id));
}

/** Test-only: wipe the entire store. */
export async function _clearAllForTests(): Promise<void> {
  await idbClear(store());
}

/**
 * Serialise a layout to a JSON string suitable for download. The
 * returned blob already validates as a v3 LayoutRecord — the
 * import path can run it through `parseLayoutRecord` directly.
 */
export async function exportLayoutJson(id: string): Promise<{
  filename: string;
  json: string;
} | null> {
  const record = await loadLayout(id);
  if (!record) return null;
  return {
    filename: exportFilename(record.name, record.savedAt),
    json: JSON.stringify(record, null, 2),
  };
}

export interface ImportLayoutOptions {
  /**
   * If true, mint a fresh id even if the imported file's id is
   * already in the store. Default: true (so importing the same
   * file twice produces two layouts rather than silently
   * overwriting one).
   */
  freshId?: boolean;
}

/**
 * Parse, validate, and persist an imported layout JSON file.
 * Throws `LayoutSchemaError` on any validation failure — the
 * thrown message is user-facing.
 */
export async function importLayoutJson(
  raw: string,
  options: ImportLayoutOptions = {},
): Promise<LayoutRecord> {
  const parsed = parseLayoutRecord(raw);
  return saveLayout({
    id: options.freshId === false ? parsed.id : newLayoutId(),
    name: parsed.name,
    elements: parsed.elements,
    thumbnail: parsed.thumbnail,
  });
}

// Re-export for callers that want to discriminate on these without
// an extra import path.
export {
  exportFilename,
  filenameSafeName,
  LayoutQuotaError,
  LayoutSchemaError,
  LAYOUT_SCHEMA_VERSION,
  newLayoutId,
} from "./layoutSchema";
export type { LayoutRecord, LayoutSummary } from "./layoutSchema";
