/**
 * Render a screensaver image URL onto an 800×480 canvas, binarise via
 * the chosen algorithm, and pack into 48 KB of 1bpp MSB-first wire
 * bytes. Independent of the editor element pipeline — the screensaver
 * just streams pre-baked images.
 *
 * Fit mode is "contain" with white pillarbox/letterbox so non-16:10
 * masters don't get distorted. Phase 10: this used to also POST the
 * bytes to /frame; now it returns bytes only — the caller decides
 * whether to push to /frame (one-shot view) or /screensaver/frame
 * (write to a slot for the cycle).
 */

import { floydSteinbergInPlace, thresholdInPlace } from "../editor/dither";
import type { DitherAlgorithm } from "../editor/types";
import { HEIGHT, WIDTH } from "../frameFormat";
import { packFrame } from "../packFrame";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`failed to load screensaver image: ${url}`));
    img.src = url;
  });
}

/**
 * Accepts a Blob/File or a string URL. Blobs go through
 * URL.createObjectURL so the dither pipeline can use the same
 * <img>-loading path it uses for bundled assets. The object URL is
 * revoked once the image has decoded.
 *
 * `algorithm` defaults to Floyd-Steinberg (matches Phase 6 image-
 * element default). Pass `"threshold"` to do a 50% luminance cut with
 * no diffusion — best for line art / logos / pre-prepared 1-bit
 * scans where dithering would only add unwanted noise.
 */
export async function renderScreensaverImageToBytes(
  source: string | Blob,
  algorithm: DitherAlgorithm = "fs",
): Promise<Uint8Array> {
  const url =
    typeof source === "string" ? source : URL.createObjectURL(source);
  const revokeWhenDone = typeof source !== "string";
  const img = await loadImage(url).finally(() => {
    if (revokeWhenDone) URL.revokeObjectURL(url);
  });

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("no 2D context for screensaver render");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const naturalW = img.naturalWidth || img.width || WIDTH;
  const naturalH = img.naturalHeight || img.height || HEIGHT;
  const scale = Math.min(WIDTH / naturalW, HEIGHT / naturalH);
  const dw = Math.round(naturalW * scale);
  const dh = Math.round(naturalH * scale);
  const dx = Math.round((WIDTH - dw) / 2);
  const dy = Math.round((HEIGHT - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);

  return binarisePackCanvas(ctx, algorithm);
}

/**
 * Binarise an 800×480 canvas's pixels via the chosen algorithm and
 * pack to 1bpp MSB-first wire bytes. Exported so the algorithm-
 * dispatch logic can be tested without wrangling jsdom image loading
 * — the upstream `renderScreensaverImageToBytes` is just `loadImage`
 * + drawImage onto the canvas this helper consumes.
 */
export function binarisePackCanvas(
  ctx: CanvasRenderingContext2D,
  algorithm: DitherAlgorithm,
): Uint8Array {
  const data = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  if (algorithm === "fs") {
    floydSteinbergInPlace(data, /*invert=*/ false);
  } else {
    thresholdInPlace(data, /*threshold=*/ undefined, /*invert=*/ false);
  }
  ctx.putImageData(data, 0, 0);
  return packFrame(ctx.getImageData(0, 0, WIDTH, HEIGHT));
}
