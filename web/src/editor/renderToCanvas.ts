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
  // `ctx.drawImage` accepts CanvasImageSource, which @napi-rs/canvas's
  // Image satisfies under test and HTMLImageElement satisfies in the
  // browser. The cast is the seam between the two.
  ctx.drawImage(img as CanvasImageSource, el.x, el.y, el.w, el.h);
  if (el.invert) {
    // Invert ink/paper inside the bounding box only. `difference` against
    // a black-filled rect of the same footprint flips the channels for
    // every pixel that drawImage just wrote, leaving the rest of the
    // canvas alone. Threshold-binarisation downstream then turns the
    // (now ~white-on-black) silhouette into proper 1bpp ink.
    ctx.save();
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "white";
    ctx.fillRect(el.x, el.y, el.w, el.h);
    ctx.restore();
  }
}

// Rec.709 luma — same coefficients packFrame uses, kept private so the
// per-element pre-binarisation lines up with the global cutoff.
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function drawUserImage(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
): void {
  const img = getCachedImage(el.dataUrl);
  if (!img) return;

  // Per-element threshold + invert is applied on a temporary canvas
  // sized to the element so downstream rotation works the same way as
  // every other element. We draw the source into the temp at element
  // dimensions, binarise in-place, then composite onto the main
  // canvas under whatever rotation was already pushed by the caller.
  const w = Math.max(1, Math.round(el.w));
  const h = Math.max(1, Math.round(el.h));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const data = tctx.getImageData(0, 0, w, h);
  const bytes = data.data;
  const cutoff = el.threshold;
  for (let i = 0; i < bytes.length; i += 4) {
    const y = luma(bytes[i], bytes[i + 1], bytes[i + 2]);
    // Pre-binarise to pure black/white so the downstream packFrame's
    // global 128 cutoff round-trips this element verbatim.
    const ink = el.invert ? y >= cutoff : y < cutoff;
    const v = ink ? 0 : 255;
    bytes[i] = v;
    bytes[i + 1] = v;
    bytes[i + 2] = v;
    bytes[i + 3] = 255;
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
