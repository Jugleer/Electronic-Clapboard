/**
 * Pure-2D-context rasteriser. Decoupled from Konva so the send pipeline
 * (and its tests) don't touch the interactive scene graph or any
 * selection/handle furniture. The interactive view in [EditorCanvas.tsx]
 * draws the same elements via react-konva for editing UX; this function
 * is what produces the bytes that go on the wire.
 *
 * Render is straightforward 2D-canvas: text via `fillText`, rects via
 * fill/stroke, lines via stroke. Phase 6 will replace the threshold-only
 * binarisation in `packFrame` with Floyd-Steinberg; this rasteriser
 * doesn't need to change for that — its output is RGBA, not bits.
 */

import { HEIGHT, WIDTH } from "../frameFormat";
import {
  applyBrightnessContrast,
  floydSteinbergInPlace,
  thresholdInPlace,
} from "./dither";
import { getCachedIcon } from "./icons/loader";
import { getCachedImage } from "./imageCache";
import { cssFontFamily } from "./types";
import type {
  Element,
  IconElement,
  ImageElement,
  LineElement,
  RectElement,
  TextElement,
} from "./types";

export function rasterizeElements(elements: Element[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not get 2D context for offscreen canvas");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const el of elements) {
    ctx.save();
    if (el.rotation) {
      // Rotation pivots around the element's top-left, matching
      // Konva's default rotation origin.
      ctx.translate(el.x, el.y);
      ctx.rotate((el.rotation * Math.PI) / 180);
      ctx.translate(-el.x, -el.y);
    }
    if (el.type === "rect") drawRect(ctx, el);
    else if (el.type === "line") drawLine(ctx, el);
    else if (el.type === "icon") drawIcon(ctx, el);
    else if (el.type === "image") drawUserImage(ctx, el);
    else drawText(ctx, el);
    ctx.restore();
  }
  return canvas;
}

function drawRect(ctx: CanvasRenderingContext2D, el: RectElement): void {
  if (el.filled) {
    ctx.fillStyle = "black";
    ctx.fillRect(el.x, el.y, el.w, el.h);
    return;
  }
  ctx.strokeStyle = "black";
  ctx.lineWidth = el.strokeWidth;
  ctx.strokeRect(el.x, el.y, el.w, el.h);
}

function drawLine(ctx: CanvasRenderingContext2D, el: LineElement): void {
  ctx.strokeStyle = "black";
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(el.x, el.y);
  ctx.lineTo(el.x + el.w, el.y + el.h);
  ctx.stroke();
}

function drawIcon(ctx: CanvasRenderingContext2D, el: IconElement): void {
  const img = getCachedIcon(el.src);
  if (!img) {
    // Cache miss — leaves the icon's footprint paper-coloured. The
    // App preloads on mount, so the only way to hit this path in
    // production is racing the very first user click during preload.
    // The interactive view shows the same blank, which is honest.
    return;
  }
  // Icons are vendored as RGBA — strokes on a transparent canvas. We
  // draw onto an element-sized temp canvas, then walk the pixels to
  // convert each one into pure ink, pure paper, or transparent (so
  // it falls through to whatever was beneath the icon). Without the
  // pre-pass, packFrame's luminance threshold would treat
  // transparent-RGB-zero pixels as ink and fill the bbox with black.
  const w = Math.max(1, Math.round(el.w));
  const h = Math.max(1, Math.round(el.h));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  // `ctx.drawImage` accepts CanvasImageSource, which @napi-rs/canvas's
  // Image satisfies under test and HTMLImageElement satisfies in the
  // browser. The cast is the seam between the two.
  tctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const data = tctx.getImageData(0, 0, w, h);
  const bytes = data.data;
  // Alpha is the mask: anywhere the source had stroke ink, the alpha
  // is opaque; the rest of the icon's bbox is transparent. Luminance
  // is unreliable here because the Tabler scale-down adds anti-alias
  // greys that produce surprising "halo" patterns when run through a
  // luma threshold. Alpha-as-mask matches the user's mental model:
  // `invert` flips the stroke ink itself, transparent regions stay
  // transparent so whatever's beneath the icon shows through.
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3];
    if (a < 128) {
      bytes[i] = 0;
      bytes[i + 1] = 0;
      bytes[i + 2] = 0;
      bytes[i + 3] = 0;
      continue;
    }
    const v = el.invert ? 255 : 0;
    bytes[i] = v;
    bytes[i + 1] = v;
    bytes[i + 2] = v;
    bytes[i + 3] = 255;
  }
  tctx.putImageData(data, 0, 0);
  ctx.drawImage(tmp, el.x, el.y, w, h);
}

function drawUserImage(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
): void {
  const img = getCachedImage(el.dataUrl);
  if (!img) return;

  // The dither runs on a temp canvas sized to the element so the
  // diffusion happens at the *output* resolution, not the source's
  // native size. Resizing the element re-runs FS at the new size,
  // which matches the user's expectation that "bigger element →
  // visibly more dither detail". Re-running every send means we
  // never cache stale dithered output across (algorithm, threshold,
  // brightness, contrast) changes.
  const w = Math.max(1, Math.round(el.w));
  const h = Math.max(1, Math.round(el.h));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const data = tctx.getImageData(0, 0, w, h);

  if (el.brightness !== 0 || el.contrast !== 0) {
    applyBrightnessContrast(data, el.brightness, el.contrast);
  }
  if (el.algorithm === "fs") {
    floydSteinbergInPlace(data, el.invert);
  } else {
    thresholdInPlace(data, el.threshold, el.invert);
  }

  tctx.putImageData(data, 0, 0);
  ctx.drawImage(tmp, el.x, el.y, w, h);
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement): void {
  ctx.fillStyle = "black";
  const style = el.italic ? "italic " : "";
  const weight = el.bold ? "bold " : "";
  ctx.font = `${style}${weight}${el.fontSize}px ${cssFontFamily(el.fontFamily)}`;
  ctx.textBaseline = "top";
  ctx.textAlign = el.align;
  const lineHeight = Math.ceil(el.fontSize * 1.2);
  const lines = el.text.split("\n");
  const blockHeight = lineHeight * lines.length;
  let drawX = el.x;
  if (el.align === "center") drawX = el.x + el.w / 2;
  else if (el.align === "right") drawX = el.x + el.w;
  let drawY = el.y;
  if (el.verticalAlign === "middle") drawY = el.y + (el.h - blockHeight) / 2;
  else if (el.verticalAlign === "bottom") drawY = el.y + el.h - blockHeight;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], drawX, drawY + i * lineHeight);
  }
}
