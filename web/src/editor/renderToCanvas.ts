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
import { cssFontFamily } from "./types";
import type { Element, LineElement, RectElement, TextElement } from "./types";

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
