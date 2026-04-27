/**
 * Canvas glue: read RGBA pixels off an `ImageData`-shaped object, threshold
 * by Rec.709 luminance, and pack into 1bpp MSB-first wire bytes via
 * frameFormat.packFrame1bppMsb. Phase 3's contract is threshold-only — the
 * dithering pipeline lives in Phase 6.
 *
 * Bit sense: 1 = ink (black), 0 = paper (white). MSB-first per
 * docs/protocol.md §1. Default threshold matches PIL `mode '1'`: pixels
 * with luminance < 128 become ink, ≥ 128 become paper.
 *
 * The function takes an `ImageData`-shaped object (`{ data, width, height }`)
 * rather than an HTMLCanvasElement. This keeps the packer a pure function,
 * unit-testable in node without jsdom or a canvas polyfill. Browser callers
 * pass the result of `ctx.getImageData(0, 0, WIDTH, HEIGHT)` directly.
 */

import { FRAME_BYTES, HEIGHT, WIDTH, packFrame1bppMsb } from "./frameFormat";

export const LUMINANCE_THRESHOLD = 128;

// Rec.709 luma coefficients (Y' = 0.2126 R + 0.7152 G + 0.0722 B). Matches
// the perceptual weighting noted in the Phase 3 plan and is what Pillow uses
// when it grayscales for `mode '1'` conversion.
const R_COEFF = 0.2126;
const G_COEFF = 0.7152;
const B_COEFF = 0.0722;

export interface PackableImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function packFrame(
  image: PackableImageData,
  threshold: number = LUMINANCE_THRESHOLD,
): Uint8Array {
  if (image.width !== WIDTH || image.height !== HEIGHT) {
    throw new Error(
      `expected ${WIDTH}×${HEIGHT} image, got ${image.width}×${image.height}`,
    );
  }
  const { data } = image;
  const expectedLen = WIDTH * HEIGHT * 4;
  if (data.length !== expectedLen) {
    throw new Error(
      `expected ${expectedLen} RGBA bytes, got ${data.length}`,
    );
  }

  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0, p = 0; p < pixels.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = R_COEFF * r + G_COEFF * g + B_COEFF * b;
    pixels[p] = y < threshold ? 1 : 0;
  }
  const out = packFrame1bppMsb(pixels);
  if (out.length !== FRAME_BYTES) {
    throw new Error(
      `bug: packFrame1bppMsb returned ${out.length} bytes`,
    );
  }
  return out;
}
