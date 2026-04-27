// @vitest-environment jsdom

import "./testSetup";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";

import {
  clearImageCacheForTesting,
  setCachedImageForTesting,
} from "./imageCache";
import {
  DEFAULT_IMAGE_BRIGHTNESS,
  DEFAULT_IMAGE_CONTRAST,
  type ImageElement,
} from "./types";
import { ditherToCanvas } from "./useDitheredImagePreview";

const FAKE_URL = "data:image/png;base64,preview-test";

function makeFlatGreyImage(value: number): unknown {
  // 16×16 grey block — enough pixels for FS to produce a visible
  // checkerboard, small enough to keep the test fast.
  const c = createCanvas(16, 16);
  const ctx = c.getContext("2d");
  ctx.fillStyle = `rgb(${value}, ${value}, ${value})`;
  ctx.fillRect(0, 0, 16, 16);
  return c;
}

function imageElement(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: "preview-img",
    type: "image",
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    rotation: 0,
    locked: false,
    groupId: null,
    dataUrl: FAKE_URL,
    algorithm: "fs",
    threshold: 128,
    brightness: DEFAULT_IMAGE_BRIGHTNESS,
    contrast: DEFAULT_IMAGE_CONTRAST,
    invert: false,
    ...overrides,
  };
}

beforeAll(() => {
  setCachedImageForTesting(FAKE_URL, makeFlatGreyImage(128));
});

afterEach(() => {
  setCachedImageForTesting(FAKE_URL, makeFlatGreyImage(128));
});

describe("ditherToCanvas", () => {
  it("returns null when the source image isn't cached yet", () => {
    clearImageCacheForTesting();
    const canvas = ditherToCanvas(
      imageElement({ dataUrl: "data:image/png;base64,not-cached" }),
    );
    expect(canvas).toBeNull();
  });

  it("produces a canvas at the element's pixel dimensions", () => {
    const canvas = ditherToCanvas(imageElement({ w: 80, h: 40 }));
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBe(80);
    expect(canvas!.height).toBe(40);
  });

  it("FS on flat 50% grey lands roughly half ink half paper", () => {
    const canvas = ditherToCanvas(imageElement({ w: 32, h: 32, algorithm: "fs" }))!;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let ink = 0;
    let paper = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 0) ink++;
      else if (data[i] === 255) paper++;
    }
    // FS on flat 128 → exactly half ink / half paper modulo edge
    // effects on a 32×32 patch.
    expect(ink + paper).toBe(32 * 32);
    expect(ink).toBeGreaterThan(32 * 32 * 0.4);
    expect(ink).toBeLessThan(32 * 32 * 0.6);
  });

  it("threshold path shifts ink coverage with the cutoff", () => {
    setCachedImageForTesting(FAKE_URL, makeFlatGreyImage(127));
    const lowCut = ditherToCanvas(
      imageElement({ algorithm: "threshold", threshold: 100, w: 16, h: 16 }),
    )!;
    const highCut = ditherToCanvas(
      imageElement({ algorithm: "threshold", threshold: 200, w: 16, h: 16 }),
    )!;
    const lowInk = countInk(lowCut);
    const highInk = countInk(highCut);
    // Source luma 127 < 200 (highInk: all ink) but > 100 (lowInk: all paper).
    expect(highInk).toBeGreaterThan(lowInk);
  });

  it("brightness +100 saturates the FS preview to all paper", () => {
    const canvas = ditherToCanvas(
      imageElement({ algorithm: "fs", brightness: 100, w: 16, h: 16 }),
    )!;
    expect(countInk(canvas)).toBe(0);
  });

  it("invert flips FS output in place", () => {
    const a = ditherToCanvas(imageElement({ algorithm: "fs", w: 16, h: 16 }))!;
    const b = ditherToCanvas(
      imageElement({ algorithm: "fs", w: 16, h: 16, invert: true }),
    )!;
    expect(countInk(a) + countInk(b)).toBe(16 * 16);
  });
});

function countInk(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 0 && data[i + 3] > 0) ink++;
  }
  return ink;
}
