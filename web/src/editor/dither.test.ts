/**
 * Phase 6 dither tests. The keystone is the byte-equality assertion
 * against the PIL-generated oracle in `fs_oracle_gradient.bin`. If
 * that test passes, our FS implementation matches PIL byte-for-byte
 * on the canonical input — which is the bar Phase 6 sets.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  applyBrightnessContrast,
  floydSteinbergInPlace,
  thresholdInPlace,
} from "./dither";

const FIXTURE_URL = new URL(
  "../__fixtures__/fs_oracle_gradient.bin",
  import.meta.url,
);

interface OracleFixture {
  width: number;
  height: number;
  input: Uint8Array; // L8
  output: Uint8Array; // packed 1bpp, MSB-first, 1 = ink
}

function readOracle(): OracleFixture {
  const buf = readFileSync(fileURLToPath(FIXTURE_URL));
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== "FSO1") throw new Error(`bad magic: ${magic}`);
  const width = buf.readUInt16LE(4);
  const height = buf.readUInt16LE(6);
  const inputStart = 8;
  const inputEnd = inputStart + width * height;
  const outputStart = inputEnd;
  const bytesPerRow = (width + 7) >> 3;
  const input = new Uint8Array(buf.subarray(inputStart, inputEnd));
  const output = new Uint8Array(buf.subarray(outputStart, outputStart + bytesPerRow * height));
  return { width, height, input, output };
}

function l8ToRgba(l8: Uint8Array, w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, i = 0; p < l8.length; p++, i += 4) {
    const v = l8[p];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function packInk(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const { data, width: w, height: h } = img;
  const bpr = (w + 7) >> 3;
  const out = new Uint8Array(bpr * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Ink = pixel is black (any channel zero is enough since dither
      // writes pure 0 or 255 to all RGB channels).
      const isInk = data[i] < 128;
      if (isInk) {
        out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return out;
}

describe("floyd-steinberg dither", () => {
  it("matches PIL byte-for-byte on the oracle gradient", () => {
    const oracle = readOracle();
    const img = l8ToRgba(oracle.input, oracle.width, oracle.height);
    floydSteinbergInPlace(img);
    const packed = packInk(img);
    expect(packed).toEqual(oracle.output);
  });

  it("produces pure black/white output", () => {
    const img = l8ToRgba(new Uint8Array(64).fill(127), 8, 8);
    floydSteinbergInPlace(img);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i];
      expect(v === 0 || v === 255).toBe(true);
      expect(img.data[i + 1]).toBe(v);
      expect(img.data[i + 2]).toBe(v);
      expect(img.data[i + 3]).toBe(255);
    }
  });

  it("flat black input dithers to all-ink", () => {
    const img = l8ToRgba(new Uint8Array(64).fill(0), 8, 8);
    floydSteinbergInPlace(img);
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(0);
    }
  });

  it("flat white input dithers to all-paper", () => {
    const img = l8ToRgba(new Uint8Array(64).fill(255), 8, 8);
    floydSteinbergInPlace(img);
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);
    }
  });

  it("invert flips the output", () => {
    const img = l8ToRgba(new Uint8Array(64).fill(0), 8, 8);
    floydSteinbergInPlace(img, true);
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);
    }
  });
});

describe("threshold", () => {
  it("cuts at 128 by default (Phase 3 contract)", () => {
    const data = new Uint8ClampedArray([
      127, 127, 127, 255,
      128, 128, 128, 255,
    ]);
    thresholdInPlace({ data, width: 2, height: 1 });
    expect(data[0]).toBe(0); // 127 → ink
    expect(data[4]).toBe(255); // 128 → paper
  });

  it("invert flips the cut", () => {
    const data = new Uint8ClampedArray([
      127, 127, 127, 255,
      128, 128, 128, 255,
    ]);
    thresholdInPlace({ data, width: 2, height: 1 }, 128, true);
    expect(data[0]).toBe(255);
    expect(data[4]).toBe(0);
  });

  it("custom threshold shifts the cut", () => {
    const data = new Uint8ClampedArray([
      99, 99, 99, 255,
      100, 100, 100, 255,
    ]);
    thresholdInPlace({ data, width: 2, height: 1 }, 100);
    expect(data[0]).toBe(0);
    expect(data[4]).toBe(255);
  });
});

describe("brightness/contrast pre-pass", () => {
  it("is a no-op at 0/0", () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255, 200, 150, 100, 200]);
    const data = new Uint8ClampedArray(original);
    applyBrightnessContrast({ data, width: 2, height: 1 }, 0, 0);
    // Alpha untouched; RGB unchanged at 0/0.
    expect(Array.from(data)).toEqual(Array.from(original));
  });

  it("brightness +100 saturates all channels white", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255]);
    applyBrightnessContrast({ data, width: 2, height: 1 }, 100, 0);
    for (let i = 0; i < 8; i += 4) {
      expect(data[i]).toBe(255);
      expect(data[i + 1]).toBe(255);
      expect(data[i + 2]).toBe(255);
    }
  });

  it("brightness -100 saturates all channels black", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 255]);
    applyBrightnessContrast({ data, width: 2, height: 1 }, -100, 0);
    for (let i = 0; i < 8; i += 4) {
      expect(data[i]).toBe(0);
      expect(data[i + 1]).toBe(0);
      expect(data[i + 2]).toBe(0);
    }
  });

  it("contrast +100 pushes mid greys to extremes around 128", () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255, 156, 156, 156, 255]);
    applyBrightnessContrast({ data, width: 2, height: 1 }, 0, 100);
    expect(data[0]).toBeLessThan(50);
    expect(data[4]).toBeGreaterThan(200);
  });

  it("contrast -100 collapses everything toward 128", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    applyBrightnessContrast({ data, width: 2, height: 1 }, 0, -100);
    // Both channels collapse close to mid-grey.
    expect(Math.abs(data[0] - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(data[4] - 128)).toBeLessThanOrEqual(2);
  });

  it("alpha is never modified", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 7, 255, 255, 255, 200]);
    applyBrightnessContrast({ data, width: 2, height: 1 }, 50, 50);
    expect(data[3]).toBe(7);
    expect(data[7]).toBe(200);
  });
});
