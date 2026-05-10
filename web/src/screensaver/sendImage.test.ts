// @vitest-environment jsdom

import "../editor/testSetup";

import { describe, expect, it } from "vitest";

import { FRAME_BYTES, HEIGHT, WIDTH } from "../frameFormat";
import { binarisePackCanvas } from "./sendImage";

// We test the algorithm dispatch on the binarise+pack helper, which
// is the only meaningful new behaviour added with the algorithm
// parameter. The full renderScreensaverImageToBytes pipeline (load
// image → drawImage → binarisePackCanvas) is exercised end-to-end
// by Screensaver.test.tsx via vi.mock, and by manual bench upload.
//
// dither.test.ts and fs_oracle_gradient.bin pin the per-pixel
// behaviour of the helpers themselves byte-for-byte against Pillow;
// this file just confirms the right helper runs for each algorithm
// argument.

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  // Three vertical bands: black (0..266), mid-grey (266..533),
  // white (533..800). Mid-grey is the canonical case where threshold
  // collapses to paper while FS produces a stipple pattern.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, Math.floor(WIDTH / 3), HEIGHT);
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(Math.floor(WIDTH / 3), 0, Math.floor(WIDTH / 3), HEIGHT);
  return c;
}

describe("binarisePackCanvas — algorithm dispatch", () => {
  it("returns 48000 bytes for both algorithms", () => {
    const c = makeCanvas();
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const fs = binarisePackCanvas(ctx, "fs");
    // Re-create the canvas because each call mutates its pixels via
    // putImageData (the binarise step writes the binarised result
    // back to the canvas before packing).
    const c2 = makeCanvas();
    const ctx2 = c2.getContext("2d", { willReadFrequently: true })!;
    const th = binarisePackCanvas(ctx2, "threshold");
    expect(fs.length).toBe(FRAME_BYTES);
    expect(th.length).toBe(FRAME_BYTES);
  });

  it("FS-dither and threshold diverge on a mid-grey input", () => {
    // The mid-grey band is exactly the case where the two algorithms
    // disagree: threshold collapses it to paper (luma 128 >= 128 ⇒
    // not-ink), FS stipples it. The two byte streams must therefore
    // differ on the bytes covering the mid-grey band.
    const fsCanvas = makeCanvas();
    const fs = binarisePackCanvas(
      fsCanvas.getContext("2d", { willReadFrequently: true })!,
      "fs",
    );
    const thCanvas = makeCanvas();
    const th = binarisePackCanvas(
      thCanvas.getContext("2d", { willReadFrequently: true })!,
      "threshold",
    );
    let diff = 0;
    for (let i = 0; i < fs.length; i++) {
      if (fs[i] !== th[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it("solid black canvas → all 0xFF for both algorithms", () => {
    // Canary: solid-input parity catches inverted bit-sense or off-by-
    // one errors in the binarise step. Both algorithms must agree on
    // the all-ink case.
    const c = document.createElement("canvas");
    c.width = WIDTH;
    c.height = HEIGHT;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const fs = binarisePackCanvas(ctx, "fs");
    expect(fs.every((b) => b === 0xff)).toBe(true);

    // Re-fill (FS mutated it) for the threshold pass.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const th = binarisePackCanvas(ctx, "threshold");
    expect(th.every((b) => b === 0xff)).toBe(true);
  });

  it("solid white canvas → all 0x00 for both algorithms", () => {
    const c = document.createElement("canvas");
    c.width = WIDTH;
    c.height = HEIGHT;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const fs = binarisePackCanvas(ctx, "fs");
    expect(fs.every((b) => b === 0x00)).toBe(true);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const th = binarisePackCanvas(ctx, "threshold");
    expect(th.every((b) => b === 0x00)).toBe(true);
  });
});
