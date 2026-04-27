/**
 * Floyd-Steinberg dither + threshold + brightness/contrast pre-pass.
 * Pure functions over `ImageData`-shaped buffers; no DOM, no canvas.
 *
 * The FS path is a faithful port of Pillow's `tobilevel(L → 1)` in
 * libImaging/Convert.c. Vitest asserts byte equality against a
 * PIL-generated fixture (`fs_oracle_gradient.bin`) so the equivalence
 * claim stays honest. Notes on the porting:
 *
 *   - Operates on integer luminance, not floats. Errors propagate as
 *     a single (l + errors[x+1]) sum divided by 16 once per pixel.
 *   - `Math.trunc(.../16)` matches C's truncating-toward-zero division.
 *     Using `>> 4` would arithmetic-shift toward minus-infinity for
 *     negative carries and diverge on a few percent of pixels.
 *   - CLIP8 clamps the running luminance to [0, 255] BEFORE the
 *     threshold compare. This is non-negotiable — drop the clamp and
 *     the algorithm overshoots on high-contrast edges.
 *   - PIL's threshold is `l > 128` → paper. So a luminance of exactly
 *     128 becomes ink. Phase 3's `packFrame` threshold uses `< 128 →
 *     ink` (so 128 → paper); these only disagree at the exact boundary.
 *     Threshold-only callers use `thresholdInPlace` here, not packFrame,
 *     so the two paths can stay slightly different.
 *   - Per-row carry triple `(l, l0, l1)` and a `(W + 1)`-entry errors
 *     array are PIL's data structures; renaming them would obscure
 *     the porting trail.
 *
 * Bit sense for callers: this writes `data` as RGBA where pure
 * black (0,0,0,255) is ink and pure white (255,255,255,255) is paper.
 * The downstream `packFrame` reads luminance and applies its own
 * threshold; ink pixels are well below 128 so the round-trip is
 * verbatim.
 *
 * Brightness range: [-100, 100]. Contrast range: [-100, 100]. Both
 * centred at 0; the slider defaults to 0/0 which is a no-op.
 */

export const FS_THRESHOLD = 128;
export const BRIGHTNESS_RANGE = 100;
export const CONTRAST_RANGE = 100;

const R = 0.2126;
const G = 0.7152;
const B = 0.0722;

/**
 * In-place per-pixel brightness/contrast pre-pass on RGBA bytes. Each
 * channel is shifted/scaled identically so a chromatic source still
 * grayscales identically downstream.
 *
 * Brightness: linear shift in [-255, +255] mapped from the slider
 * range [-100, +100]; brightness = 100 saturates to white.
 * Contrast: GIMP/Photoshop's `(259 * (c + 255)) / (255 * (259 - c))`
 * curve, centred on 128.
 */
export function applyBrightnessContrast(
  img: { data: Uint8ClampedArray; width: number; height: number },
  brightness: number,
  contrast: number,
): void {
  const { data } = img;
  const b = (clamp(brightness, -BRIGHTNESS_RANGE, BRIGHTNESS_RANGE) * 255) / 100;
  const c = (clamp(contrast, -CONTRAST_RANGE, CONTRAST_RANGE) * 255) / 100;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte(factor * (data[i] - 128) + 128 + b);
    data[i + 1] = clampByte(factor * (data[i + 1] - 128) + 128 + b);
    data[i + 2] = clampByte(factor * (data[i + 2] - 128) + 128 + b);
  }
}

/** Threshold-only binarisation. RGBA in, RGBA out (in-place). */
export function thresholdInPlace(
  img: { data: Uint8ClampedArray; width: number; height: number },
  threshold: number = FS_THRESHOLD,
  invert: boolean = false,
): void {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const y = R * data[i] + G * data[i + 1] + B * data[i + 2];
    const ink = invert ? y >= threshold : y < threshold;
    const v = ink ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
}

/**
 * Floyd-Steinberg dither, raster-order, byte-equivalent to
 * `Image.convert("1", dither=Image.Dither.FLOYDSTEINBERG)`.
 *
 * `invert: true` flips ink/paper after the dither — the diffusion
 * pattern is unchanged, only the final bit assignment swaps.
 */
export function floydSteinbergInPlace(
  img: { data: Uint8ClampedArray; width: number; height: number },
  invert: boolean = false,
): void {
  const { data, width: w, height: h } = img;
  // Grayscale once into a Int32 buffer (PIL operates directly on L8;
  // we synthesise L from RGBA via Rec.709 and round to int).
  const luma = new Int32Array(w * h);
  for (let i = 0, p = 0; p < luma.length; p++, i += 4) {
    luma[p] = Math.round(R * data[i] + G * data[i + 1] + B * data[i + 2]);
  }

  const errors = new Int32Array(w + 1);
  for (let y = 0; y < h; y++) {
    let l = 0;
    let l0 = 0;
    let l1 = 0;
    for (let x = 0; x < w; x++) {
      l = clip8(luma[y * w + x] + trunc16(l + errors[x + 1]));
      const paper = l > 128;
      const out = paper ? 255 : 0;
      l -= out;
      const l2 = l;
      const d2 = l + l;
      l += d2;
      errors[x] = l + l0;
      l += d2;
      l0 = l + l1;
      l1 = l2;
      l += d2;
      const o = (y * w + x) * 4;
      const isInk = invert ? paper : !paper;
      const v = isInk ? 0 : 255;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
    errors[w] = l0;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function clip8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function trunc16(v: number): number {
  return Math.trunc(v / 16);
}
