/**
 * TS mirror of `src/template_wire.h` — build the 48,100-byte
 * `POST /template` body from an editor scene.
 *
 * Two halves:
 *   bytes 0..47999    the background raster, with every CAN field box left
 *                     BLANK
 *   bytes 48000..48099 a fixed 100-byte region trailer
 *
 * The blanking is the subtle half. A CAN field's `text` is a design-time
 * placeholder so the author can judge how much fits; baking it into the
 * raster would leave "SCENE 99" burned in behind every real value the robot
 * ever sends. So the exporter rasterises the scene with CAN fields omitted
 * entirely — the box is paper, and the firmware draws into it at runtime.
 *
 * Any change here must be mirrored in src/template_wire.h and covered by
 * test/test_template_wire/.
 */

import { FRAME_BYTES } from "../frameFormat";
import { packFrame } from "../packFrame";
import { rasterizeElements } from "./renderToCanvas";
import type {
  CanFieldId,
  CanFontId,
  Element,
  TextAlign,
  TextElement,
  VerticalAlign,
} from "./types";

export const RASTER_BYTES = FRAME_BYTES; // 48000
export const REGION_BYTES = 12;
export const TRAILER_HEADER = 4;
export const MAX_REGIONS = 8;
export const TRAILER_BYTES = TRAILER_HEADER + REGION_BYTES * MAX_REGIONS; // 100
export const BODY_BYTES = RASTER_BYTES + TRAILER_BYTES; // 48100

/** Bytes 'T','L' — little-endian 0x4C54. See template_wire.h for why. */
export const MAGIC = 0x4c54;
export const VERSION = 1;

/** Device storage cap. The wire allows ids 0–15; flash allows 8. */
export const MAX_TEMPLATES = 8;

export const PANEL_W = 800;
export const PANEL_H = 480;

const H_ALIGN_CODE: Record<TextAlign, number> = { left: 0, center: 1, right: 2 };
const V_ALIGN_CODE: Record<VerticalAlign, number> = { top: 0, middle: 1, bottom: 2 };

const FLAG_INVERT = 0x10;

export interface CanFieldRegion {
  fieldId: CanFieldId;
  x: number;
  y: number;
  w: number;
  h: number;
  font: CanFontId;
  halign: TextAlign;
  valign: VerticalAlign;
  invert: boolean;
}

export type ValidationError =
  | { kind: "duplicate-field-id"; fieldId: number }
  | { kind: "too-many-fields"; count: number }
  | { kind: "out-of-bounds"; fieldId: number }
  | { kind: "degenerate"; fieldId: number }
  | { kind: "no-font"; fieldId: number };

export function describeError(e: ValidationError): string {
  switch (e.kind) {
    case "duplicate-field-id":
      return `Two text boxes are both assigned to CAN field ${e.fieldId}. Each field id may be used once.`;
    case "too-many-fields":
      return `${e.count} CAN fields defined, but the wire format carries at most ${MAX_REGIONS}.`;
    case "out-of-bounds":
      return `Field ${e.fieldId} extends outside the ${PANEL_W}×${PANEL_H} panel.`;
    case "degenerate":
      return `Field ${e.fieldId} has zero width or height.`;
    case "no-font":
      return `Field ${e.fieldId} has no device font selected.`;
  }
}

/** True for a text element that has been marked as a CAN-driven field. */
export function isCanField(
  el: Element,
): el is TextElement & { canFieldId: CanFieldId } {
  return el.type === "text" && el.canFieldId !== undefined;
}

/**
 * Collect the CAN field regions from a scene, in ascending field-id order.
 *
 * Sorted rather than left in scene order so the exported bytes are stable
 * for a given design: re-stacking layers in the editor should not produce a
 * different template body, or two identical-looking uploads become
 * needlessly un-diffable.
 */
export function collectRegions(elements: Element[]): CanFieldRegion[] {
  const out: CanFieldRegion[] = [];
  for (const el of elements) {
    if (!isCanField(el)) continue;
    out.push({
      fieldId: el.canFieldId,
      // Round rather than truncate: the editor works in floats and a box
      // dragged to x=99.6 should land on 100, not 99.
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.w),
      h: Math.round(el.h),
      font: (el.canFontId ?? 4) as CanFontId, // 4 = SansBold24, the body default
      halign: el.align,
      valign: el.verticalAlign,
      invert: false,
    });
  }
  out.sort((a, b) => a.fieldId - b.fieldId);
  return out;
}

export function validateRegions(regions: CanFieldRegion[]): ValidationError[] {
  const errors: ValidationError[] = [];

  if (regions.length > MAX_REGIONS) {
    errors.push({ kind: "too-many-fields", count: regions.length });
  }

  const seen = new Set<number>();
  for (const r of regions) {
    if (seen.has(r.fieldId)) {
      errors.push({ kind: "duplicate-field-id", fieldId: r.fieldId });
    }
    seen.add(r.fieldId);

    if (r.w <= 0 || r.h <= 0) {
      errors.push({ kind: "degenerate", fieldId: r.fieldId });
      continue;
    }
    if (r.x < 0 || r.y < 0 || r.x + r.w > PANEL_W || r.y + r.h > PANEL_H) {
      errors.push({ kind: "out-of-bounds", fieldId: r.fieldId });
    }
    if (r.font === undefined || r.font < 0 || r.font > 7) {
      errors.push({ kind: "no-font", fieldId: r.fieldId });
    }
  }
  return errors;
}

/** Encode one 12-byte region record. Mirrors `template_wire::encode_region`. */
export function encodeRegion(r: CanFieldRegion, view: DataView, off: number): void {
  view.setUint8(off + 0, r.fieldId);
  view.setInt16(off + 1, r.x, /*littleEndian=*/ true);
  view.setInt16(off + 3, r.y, true);
  view.setUint16(off + 5, r.w, true);
  view.setUint16(off + 7, r.h, true);
  view.setUint8(off + 9, r.font);
  const flags =
    (H_ALIGN_CODE[r.halign] & 0x03) |
    ((V_ALIGN_CODE[r.valign] & 0x03) << 2) |
    (r.invert ? FLAG_INVERT : 0);
  view.setUint8(off + 10, flags);
  view.setUint8(off + 11, 0); // reserved
}

/** Encode the 100-byte trailer. Mirrors `template_wire::encode_trailer`. */
export function encodeTrailer(regions: CanFieldRegion[]): Uint8Array {
  const buf = new Uint8Array(TRAILER_BYTES); // zero-filled, which the format requires
  const view = new DataView(buf.buffer);
  view.setUint16(0, MAGIC, true);
  view.setUint8(2, VERSION);
  view.setUint8(3, regions.length);
  regions.forEach((r, i) => {
    if (i >= MAX_REGIONS) return;
    encodeRegion(r, view, TRAILER_HEADER + i * REGION_BYTES);
  });
  return buf;
}

export interface BuildResult {
  body: Uint8Array;
  regions: CanFieldRegion[];
  errors: ValidationError[];
}

/**
 * Build the full upload body from a scene.
 *
 * `threshold` and `dither` are passed through to {@link packFrame} so the
 * background binarises identically to a normal `/frame` send — a template's
 * artwork should not look different from the same artwork sent as a frame.
 */
export function buildTemplateBody(
  elements: Element[],
  opts: { threshold?: number } = {},
): BuildResult {
  const regions = collectRegions(elements);
  const errors = validateRegions(regions);
  if (errors.length > 0) {
    return { body: new Uint8Array(0), regions, errors };
  }

  // Rasterise WITHOUT the CAN fields. Their boxes stay paper; the firmware
  // composites real values into them at runtime.
  const staticOnly = elements.filter((el) => !isCanField(el));
  const canvas = rasterizeElements(staticOnly);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not get 2D context for the template raster");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const raster = packFrame(imageData, opts.threshold);

  if (raster.length !== RASTER_BYTES) {
    throw new Error(
      `raster is ${raster.length} bytes, expected ${RASTER_BYTES}`,
    );
  }

  const body = new Uint8Array(BODY_BYTES);
  body.set(raster, 0);
  body.set(encodeTrailer(regions), RASTER_BYTES);
  return { body, regions, errors: [] };
}

export interface SendTemplateResult {
  ok: boolean;
  status: number;
  detail: string;
}

/** POST a built body to `/template?id=N`. */
export async function sendTemplate(
  host: string,
  id: number,
  body: Uint8Array,
  signal?: AbortSignal,
): Promise<SendTemplateResult> {
  if (body.length !== BODY_BYTES) {
    return {
      ok: false,
      status: 0,
      detail: `body is ${body.length} bytes, expected ${BODY_BYTES}`,
    };
  }
  try {
    const res = await fetch(`http://${host}/template?id=${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: body as BodyInit,
      signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, detail: text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
