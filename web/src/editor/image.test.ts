// @vitest-environment jsdom

import "./testSetup";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";

import { FRAME_BYTES, HEIGHT, WIDTH } from "../frameFormat";
import { packFrame } from "../packFrame";
import {
  clearImageCacheForTesting,
  setCachedImageForTesting,
} from "./imageCache";
import { rasterizeElements } from "./renderToCanvas";
import {
  DEFAULT_IMAGE_BRIGHTNESS,
  DEFAULT_IMAGE_CONTRAST,
  type Element,
  type ImageElement,
} from "./types";

// Build a 4×4 grayscale gradient and stash it in the cache under a
// known dataUrl. Real PNG decode through @napi-rs/canvas would also
// work, but feeding the cache directly is simpler and exercises the
// same drawImage path the production renderer uses.
const FAKE_URL = "data:image/png;base64,test-gradient";

function makeGradientImage(): unknown {
  const c = createCanvas(4, 4);
  const ctx = c.getContext("2d");
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = Math.floor(((x + y * 4) / 16) * 255);
      ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function readBytes(elements: Element[]): Uint8Array {
  const canvas = rasterizeElements(elements);
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  return packFrame(img);
}

function pixelAt(bytes: Uint8Array, x: number, y: number): 0 | 1 {
  const byteIdx = y * (WIDTH / 8) + Math.floor(x / 8);
  const bitIdx = 7 - (x % 8);
  return ((bytes[byteIdx] >> bitIdx) & 1) as 0 | 1;
}

function thresholdEl(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: "img",
    type: "image",
    x: 100,
    y: 100,
    w: 80,
    h: 80,
    rotation: 0,
    locked: false,
    groupId: null,
    dataUrl: FAKE_URL,
    algorithm: "threshold",
    threshold: 128,
    brightness: DEFAULT_IMAGE_BRIGHTNESS,
    contrast: DEFAULT_IMAGE_CONTRAST,
    invert: false,
    ...overrides,
  };
}

beforeAll(() => {
  setCachedImageForTesting(FAKE_URL, makeGradientImage());
});

afterEach(() => {
  // Re-seed the gradient — the cache-miss test below clears it.
  setCachedImageForTesting(FAKE_URL, makeGradientImage());
});

describe("image element — threshold path", () => {
  it("renders pre-binarised pixels inside the element bbox", () => {
    const bytes = readBytes([thresholdEl()]);
    expect(bytes.length).toBe(FRAME_BYTES);
    expect(pixelAt(bytes, 50, 50)).toBe(0);
    expect(pixelAt(bytes, 600, 400)).toBe(0);
    expect(pixelAt(bytes, 105, 105)).toBe(1);
  });

  it("invert flips the threshold comparison", () => {
    const a = readBytes([thresholdEl()]);
    const b = readBytes([thresholdEl({ id: "img2", invert: true })]);
    expect(a).not.toEqual(b);
  });

  it("threshold setting changes ink coverage", () => {
    const lowCutoff = readBytes([thresholdEl({ threshold: 64 })]);
    const highCutoff = readBytes([thresholdEl({ id: "img3", threshold: 200 })]);
    let inkLow = 0;
    let inkHigh = 0;
    for (let y = 100; y < 180; y++) {
      for (let x = 100; x < 180; x++) {
        if (pixelAt(lowCutoff, x, y)) inkLow++;
        if (pixelAt(highCutoff, x, y)) inkHigh++;
      }
    }
    expect(inkHigh).toBeGreaterThan(inkLow);
  });

  it("cache miss leaves the footprint paper-coloured", () => {
    clearImageCacheForTesting();
    const el = thresholdEl({ dataUrl: "data:image/png;base64,not-cached" });
    const bytes = readBytes([el]);
    expect(bytes.every((b) => b === 0x00)).toBe(true);
  });
});

describe("image element — fs path", () => {
  it("FS produces visibly different bytes than threshold on a gradient", () => {
    const t = readBytes([thresholdEl()]);
    const f = readBytes([thresholdEl({ id: "fs1", algorithm: "fs" })]);
    expect(t).not.toEqual(f);
  });

  it("FS coverage on flat-grey input is roughly 50/50", () => {
    const flat = "data:image/png;base64,flat";
    const c = createCanvas(8, 8);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, 8, 8);
    setCachedImageForTesting(flat, c);
    const el = thresholdEl({
      id: "fs2",
      dataUrl: flat,
      algorithm: "fs",
      x: 0,
      y: 0,
      w: 80,
      h: 80,
    });
    const bytes = readBytes([el]);
    let ink = 0;
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (pixelAt(bytes, x, y)) ink++;
      }
    }
    expect(ink).toBeGreaterThan(80 * 80 * 0.4);
    expect(ink).toBeLessThan(80 * 80 * 0.6);
  });

  it("brightness +100 with FS saturates the bbox to paper", () => {
    const el = thresholdEl({
      id: "fs3",
      algorithm: "fs",
      brightness: 100,
      x: 0,
      y: 0,
      w: 80,
      h: 80,
    });
    const bytes = readBytes([el]);
    let ink = 0;
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (pixelAt(bytes, x, y)) ink++;
      }
    }
    expect(ink).toBe(0);
  });

  it("brightness -100 with FS saturates the bbox to ink", () => {
    const el = thresholdEl({
      id: "fs4",
      algorithm: "fs",
      brightness: -100,
      x: 0,
      y: 0,
      w: 80,
      h: 80,
    });
    const bytes = readBytes([el]);
    let ink = 0;
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        if (pixelAt(bytes, x, y)) ink++;
      }
    }
    expect(ink).toBe(80 * 80);
  });
});

describe("image element — bounds", () => {
  it("respects HEIGHT bounds for elements partially off-canvas", () => {
    const el = thresholdEl({
      id: "img5",
      x: WIDTH - 40,
      y: HEIGHT - 40,
    });
    expect(() => readBytes([el])).not.toThrow();
  });
});
