/**
 * Element clipboard: serialise the current selection to JSON, paste
 * back from JSON. Travels via `navigator.clipboard` (HTTPS / localhost
 * only — the editor runs on Vite dev which is localhost, so dev works;
 * production-over-LAN doesn't, but the editor isn't deployed that way).
 *
 * Envelope ensures a stray Ctrl+V of arbitrary text doesn't crash the
 * paste handler — we only accept payloads with our magic kind+version.
 *
 * Group ids are remapped on paste: a copy that contained a group keeps
 * the within-group relationships intact, but the new ids never collide
 * with an existing group in the destination layout.
 */

import type { Element, ElementId, GroupId } from "./types";

export const CLIPBOARD_KIND = "clapboard.elements";
export const CLIPBOARD_VERSION = 1;

export interface ClipboardEnvelope {
  kind: typeof CLIPBOARD_KIND;
  schemaVersion: typeof CLIPBOARD_VERSION;
  elements: Element[];
}

export function serialise(elements: Element[]): string {
  const env: ClipboardEnvelope = {
    kind: CLIPBOARD_KIND,
    schemaVersion: CLIPBOARD_VERSION,
    elements,
  };
  return JSON.stringify(env);
}

export class ClipboardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipboardParseError";
  }
}

export function parse(raw: string): Element[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ClipboardParseError(`not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ClipboardParseError("clipboard payload is not an object");
  }
  const env = parsed as Partial<ClipboardEnvelope>;
  if (env.kind !== CLIPBOARD_KIND) {
    throw new ClipboardParseError(`not a clapboard payload (kind=${String(env.kind)})`);
  }
  if (env.schemaVersion !== CLIPBOARD_VERSION) {
    throw new ClipboardParseError(
      `unsupported schema version ${String(env.schemaVersion)} (expected ${CLIPBOARD_VERSION})`,
    );
  }
  if (!Array.isArray(env.elements)) {
    throw new ClipboardParseError("missing elements array");
  }
  return env.elements;
}

/**
 * Remap ids on a freshly-pasted batch so they never collide with the
 * destination. Group ids are remapped consistently so within-group
 * relationships survive the round-trip; ungrouped elements just get a
 * fresh id each.
 */
export function remap(
  elements: Element[],
  fresh: () => ElementId,
  freshGroup: () => GroupId,
): Element[] {
  const groupRemap = new Map<GroupId, GroupId>();
  return elements.map((el) => {
    const id = fresh();
    if (el.groupId) {
      let g = groupRemap.get(el.groupId);
      if (!g) {
        g = freshGroup();
        groupRemap.set(el.groupId, g);
      }
      return { ...el, id, groupId: g };
    }
    return { ...el, id, groupId: null };
  });
}

/**
 * Translate a batch of pasted elements so the top-left of their union
 * bbox lands at `(targetX, targetY)`. Falls back to a +10 / +10 nudge
 * from the source if `target` is null (e.g. paste with no known mouse
 * position).
 */
export function translate(
  elements: Element[],
  target: { x: number; y: number } | null,
): Element[] {
  if (elements.length === 0) return elements;
  if (!target) {
    return elements.map((el) => ({ ...el, x: el.x + 10, y: el.y + 10 }));
  }
  let minX = Infinity;
  let minY = Infinity;
  for (const el of elements) {
    const x = el.type === "line" ? Math.min(el.x, el.x + el.w) : el.x;
    const y = el.type === "line" ? Math.min(el.y, el.y + el.h) : el.y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const dx = target.x - minX;
  const dy = target.y - minY;
  return elements.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
}
