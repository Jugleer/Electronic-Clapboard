/**
 * TS mirror of `src/text_fit.h` — how much of a CAN field's value fits in
 * its region, and where it lands.
 *
 * This is a DELIBERATE DUPLICATE of firmware logic, and the duplication is
 * the point: it is what makes the editor's truncation preview truthful. The
 * whole argument for choosing fixed-size clip-and-ellipsis over
 * shrink-to-fit (docs/phased-build-plan.md Phase 14) was that the author
 * sees exactly where their text will cut. That only holds if both sides run
 * the same arithmetic over the same advance widths — which is why
 * fontMetrics.ts is generated from the firmware's own font headers rather
 * than approximated from a browser font.
 *
 * Keep in step with src/text_fit.h. The behaviours that must not drift:
 *   - ellipsis is three ASCII periods, not U+2026 (the GFX fonts have no
 *     glyph for it)
 *   - a box too narrow for even the ellipsis hard-truncates rather than
 *     rendering empty
 *   - unsupported bytes measure and render as '?'
 */

import { GFX_FONTS, FIRST_PRINTABLE, LAST_PRINTABLE } from "./fontMetrics";
import type { CanFontId, TextAlign, VerticalAlign } from "./types";

export const ELLIPSIS = "...";
export const SUBSTITUTE = "?";

export interface FitResult {
  /** How many characters of the source string are drawn. */
  drawLen: number;
  /** Whether {@link ELLIPSIS} follows those characters. */
  ellipsis: boolean;
  /** Pixel width of everything drawn, including the ellipsis. */
  pixelWidth: number;
  /** The source did not fit, whether or not the ellipsis did. */
  overflowed: boolean;
  /** Exactly what the panel will show. Handy for a preview label. */
  rendered: string;
}

function advanceIndex(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < FIRST_PRINTABLE || code > LAST_PRINTABLE) {
    return SUBSTITUTE.charCodeAt(0) - FIRST_PRINTABLE;
  }
  return code - FIRST_PRINTABLE;
}

export function advanceOf(ch: string, fontId: CanFontId): number {
  return GFX_FONTS[fontId].advances[advanceIndex(ch)];
}

export function measure(text: string, fontId: CanFontId): number {
  let w = 0;
  for (const ch of text) w += advanceOf(ch, fontId);
  return w;
}

/**
 * Decide what the panel will draw for `text` inside `maxWidth` pixels.
 * Mirrors `text_fit::fit()` case for case.
 */
export function fit(
  text: string,
  maxWidth: number,
  fontId: CanFontId,
): FitResult {
  const chars = Array.from(text);

  const full = measure(text, fontId);
  if (full <= maxWidth) {
    return {
      drawLen: chars.length,
      ellipsis: false,
      pixelWidth: full,
      overflowed: false,
      rendered: text,
    };
  }

  const ellW = measure(ELLIPSIS, fontId);
  if (ellW <= maxWidth) {
    let used = ellW;
    let n = 0;
    while (n < chars.length) {
      const next = used + advanceOf(chars[n], fontId);
      if (next > maxWidth) break;
      used = next;
      n += 1;
    }
    return {
      drawLen: n,
      ellipsis: true,
      pixelWidth: used,
      overflowed: true,
      rendered: chars.slice(0, n).join("") + ELLIPSIS,
    };
  }

  // Too narrow for even the ellipsis: hard-truncate rather than render
  // nothing. A blank region on a slate reads as "no scene number", which is
  // false; a truncated one is merely incomplete.
  let used = 0;
  let n = 0;
  while (n < chars.length) {
    const next = used + advanceOf(chars[n], fontId);
    if (next > maxWidth) break;
    used = next;
    n += 1;
  }
  return {
    drawLen: n,
    ellipsis: false,
    pixelWidth: used,
    overflowed: true,
    rendered: chars.slice(0, n).join(""),
  };
}

/** Mirrors `text_fit::h_offset()`. Saturates at 0 — never negative. */
export function hOffset(
  drawnWidth: number,
  regionWidth: number,
  align: TextAlign,
): number {
  if (drawnWidth >= regionWidth) return 0;
  if (align === "center") return Math.floor((regionWidth - drawnWidth) / 2);
  if (align === "right") return regionWidth - drawnWidth;
  return 0;
}

/**
 * Mirrors `text_fit::v_baseline()`. Returns the BASELINE offset within the
 * region, not the top edge — GFX positions glyphs relative to a baseline.
 *
 * Ascent and descent come from the font rather than the string, so a field
 * holding "xyz" sits identically to one holding "XYZ".
 */
export function vBaseline(
  regionHeight: number,
  valign: VerticalAlign,
  fontId: CanFontId,
): number {
  const { ascent, descent } = GFX_FONTS[fontId];
  if (valign === "middle") {
    return Math.floor((regionHeight - (ascent + descent)) / 2) + ascent;
  }
  if (valign === "bottom") return regionHeight - descent;
  return ascent;
}

/** Font label for the picker UI. */
export function fontLabel(fontId: CanFontId): string {
  return GFX_FONTS[fontId].label;
}

/** Total glyph height of a font, for sizing the preview. */
export function fontHeight(fontId: CanFontId): number {
  const { ascent, descent } = GFX_FONTS[fontId];
  return ascent + descent;
}
