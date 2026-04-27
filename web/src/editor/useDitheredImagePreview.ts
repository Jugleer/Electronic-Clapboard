/**
 * Live dithered preview for image elements. The Konva-side `KImage`
 * normally shows the un-dithered source; this hook produces the
 * actually-binarised preview canvas so the user can see what the
 * panel will receive without clicking Send.
 *
 * Cost shape: a 200×150 image dithered on the main thread takes
 * ~3 ms, an 800×480 takes ~50 ms. The hook debounces 100 ms after
 * the last param change (slider drag) so a fast slider doesn't
 * trigger a dither per pointermove. While a dither is pending the
 * hook keeps returning the *previous* preview canvas — no flicker
 * back to the un-dithered source — so the visual transition between
 * settings is smooth.
 *
 * Cache scope: a single canvas per element id, refreshed in place.
 * The `rasterizeElements` send pipeline does NOT read this cache —
 * it dithers fresh from source for byte-stability.
 */

import { useEffect, useRef, useState } from "react";

import {
  applyBrightnessContrast,
  floydSteinbergInPlace,
  thresholdInPlace,
} from "./dither";
import { getCachedImage } from "./imageCache";
import type { ImageElement } from "./types";

const DEBOUNCE_MS = 100;

interface PreviewParams {
  dataUrl: string;
  algorithm: ImageElement["algorithm"];
  threshold: number;
  brightness: number;
  contrast: number;
  invert: boolean;
  w: number;
  h: number;
}

function paramsKey(p: PreviewParams): string {
  return `${p.dataUrl}|${p.algorithm}|${p.threshold}|${p.brightness}|${p.contrast}|${p.invert}|${p.w}|${p.h}`;
}

/**
 * Apply the same binarisation pipeline `drawUserImage` uses, off-screen,
 * onto a fresh canvas. Returns the canvas so callers can hand it
 * directly to KImage (CanvasImageSource compatible).
 */
export function ditherToCanvas(el: ImageElement): HTMLCanvasElement | null {
  const img = getCachedImage(el.dataUrl);
  if (!img) return null;
  const w = Math.max(1, Math.round(el.w));
  const h = Math.max(1, Math.round(el.h));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (el.brightness !== 0 || el.contrast !== 0) {
    applyBrightnessContrast(data, el.brightness, el.contrast);
  }
  if (el.algorithm === "fs") {
    floydSteinbergInPlace(data, el.invert);
  } else {
    thresholdInPlace(data, el.threshold, el.invert);
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Returns the dithered preview canvas for the element (or `null`
 * while the first dither is pending or the source is still loading).
 * Re-fires whenever the dither-affecting fields change, debounced
 * 100 ms.
 */
export function useDitheredImagePreview(
  el: ImageElement,
): HTMLCanvasElement | null {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    const key = paramsKey({
      dataUrl: el.dataUrl,
      algorithm: el.algorithm,
      threshold: el.threshold,
      brightness: el.brightness,
      contrast: el.contrast,
      invert: el.invert,
      w: el.w,
      h: el.h,
    });
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    const handle = window.setTimeout(() => {
      // The cache may still be empty on the very first render after an
      // upload — the FileReader resolves before the decoded
      // HTMLImageElement is in the cache. ditherToCanvas returns null
      // in that case; we leave `canvas` whatever it was, retry on the
      // next render.
      const next = ditherToCanvas(el);
      if (next) setCanvas(next);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [
    el,
    el.dataUrl,
    el.algorithm,
    el.threshold,
    el.brightness,
    el.contrast,
    el.invert,
    el.w,
    el.h,
  ]);

  return canvas;
}
