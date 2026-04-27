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
import type { Element, ImageElement } from "./types";

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

beforeAll(() => {
  setCachedImageForTesting(FAKE_URL, makeGradientImage());
});

afterEach(() => {
  // Re-seed the gradient — the cache-miss test below clears it.
  setCachedImageForTesting(FAKE_URL, makeGradientImage());
});

describe("image element — render path", () => {
  it("renders pre-binarised pixels inside the element bbox", () => {
    const el: ImageElement = {
      id: "img1",
      type: "image",
      x: 100,
      y: 100,
      w: 80,
      h: 80,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: FAKE_URL,
      threshold: 128,
      invert: false,
    };
    const bytes = readBytes([el]);
    expect(bytes.length).toBe(FRAME_BYTES);
    // Outside the element: paper.
    expect(pixelAt(bytes, 50, 50)).toBe(0);
    expect(pixelAt(bytes, 600, 400)).toBe(0);
    // Inside: a gradient was binarised — early pixels under 128 are
    // ink, later are paper. Top-left ought to be ink (smallest v).
    expect(pixelAt(bytes, 105, 105)).toBe(1);
  });

  it("invert flips the threshold comparison", () => {
    const base: ImageElement = {
      id: "img2",
      type: "image",
      x: 100,
      y: 100,
      w: 80,
      h: 80,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: FAKE_URL,
      threshold: 128,
      invert: false,
    };
    const a = readBytes([base]);
    const b = readBytes([{ ...base, invert: true }]);
    expect(a).not.toEqual(b);
  });

  it("threshold setting changes ink coverage", () => {
    const base: ImageElement = {
      id: "img3",
      type: "image",
      x: 100,
      y: 100,
      w: 80,
      h: 80,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: FAKE_URL,
      threshold: 64,
      invert: false,
    };
    const lowCutoff = readBytes([base]);
    const highCutoff = readBytes([{ ...base, threshold: 200 }]);
    let inkLow = 0;
    let inkHigh = 0;
    for (let y = 100; y < 180; y++) {
      for (let x = 100; x < 180; x++) {
        if (pixelAt(lowCutoff, x, y)) inkLow++;
        if (pixelAt(highCutoff, x, y)) inkHigh++;
      }
    }
    // Higher threshold → more pixels classified as ink (more passes
    // the < cutoff test).
    expect(inkHigh).toBeGreaterThan(inkLow);
  });

  it("cache miss leaves the footprint paper-coloured", () => {
    clearImageCacheForTesting();
    const el: ImageElement = {
      id: "img4",
      type: "image",
      x: 0,
      y: 0,
      w: 80,
      h: 80,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: "data:image/png;base64,not-cached",
      threshold: 128,
      invert: false,
    };
    const bytes = readBytes([el]);
    expect(bytes.every((b) => b === 0x00)).toBe(true);
  });
});

describe("image element — bounds", () => {
  it("respects HEIGHT bounds for elements partially off-canvas", () => {
    const el: ImageElement = {
      id: "img5",
      type: "image",
      x: WIDTH - 40,
      y: HEIGHT - 40,
      w: 80,
      h: 80,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: FAKE_URL,
      threshold: 128,
      invert: false,
    };
    expect(() => readBytes([el])).not.toThrow();
  });
});
