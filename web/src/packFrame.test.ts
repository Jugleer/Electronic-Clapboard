import { describe, expect, it } from "vitest";

import { FRAME_BYTES, HEIGHT, WIDTH } from "./frameFormat";
import { LUMINANCE_THRESHOLD, packFrame } from "./packFrame";

// Minimal stand-in for browser ImageData. Same shape (`data`, `width`,
// `height`) so we don't need jsdom or a canvas polyfill in node test env.
function makeImageData(
  fill: (x: number, y: number) => [number, number, number, number],
  w = WIDTH,
  h = HEIGHT,
) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i + 0] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe("packFrame all-white / all-black canary", () => {
  it("packs all-white RGBA to 48000 zero bytes (paper)", () => {
    const img = makeImageData(() => WHITE);
    const out = packFrame(img);
    expect(out.length).toBe(FRAME_BYTES);
    expect(out.every((b) => b === 0x00)).toBe(true);
  });

  it("packs all-black RGBA to 48000 0xFF bytes (ink)", () => {
    const img = makeImageData(() => BLACK);
    const out = packFrame(img);
    expect(out.length).toBe(FRAME_BYTES);
    expect(out.every((b) => b === 0xff)).toBe(true);
  });
});

describe("packFrame pixel placement", () => {
  it("places (x=0, y=0) ink in the MSB of byte 0", () => {
    const img = makeImageData((x, y) =>
      x === 0 && y === 0 ? BLACK : WHITE,
    );
    const out = packFrame(img);
    expect(out[0]).toBe(0x80);
    expect(out[1]).toBe(0x00);
  });

  it("places (x=7, y=0) ink in the LSB of byte 0", () => {
    const img = makeImageData((x, y) =>
      x === 7 && y === 0 ? BLACK : WHITE,
    );
    const out = packFrame(img);
    expect(out[0]).toBe(0x01);
  });

  it("places (x=8, y=0) ink in the MSB of byte 1", () => {
    const img = makeImageData((x, y) =>
      x === 8 && y === 0 ? BLACK : WHITE,
    );
    const out = packFrame(img);
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x80);
  });

  it("places (x=0, y=1) at the start of byte 100 (row stride)", () => {
    const img = makeImageData((x, y) =>
      x === 0 && y === 1 ? BLACK : WHITE,
    );
    const out = packFrame(img);
    expect(out[99]).toBe(0x00);
    expect(out[100]).toBe(0x80);
  });
});

describe("packFrame luminance threshold", () => {
  it("uses Rec.709 luminance (green dominates)", () => {
    // Pure green at full intensity → luminance ≈ 182, above default threshold
    // 128 → paper (bit 0). Pure blue at full intensity → luminance ≈ 18, far
    // below threshold → ink (bit 1). Pure red full → ≈ 54 → ink.
    const greenImg = makeImageData(() => [0, 255, 0, 255]);
    const blueImg = makeImageData(() => [0, 0, 255, 255]);
    const redImg = makeImageData(() => [255, 0, 0, 255]);

    expect(packFrame(greenImg).every((b) => b === 0x00)).toBe(true);
    expect(packFrame(blueImg).every((b) => b === 0xff)).toBe(true);
    expect(packFrame(redImg).every((b) => b === 0xff)).toBe(true);
  });

  it("threshold is < 128 → ink, ≥ 128 → paper (matches PIL mode '1')", () => {
    expect(LUMINANCE_THRESHOLD).toBe(128);
    const grey = (v: number): [number, number, number, number] => [v, v, v, 255];
    // r=g=b=127 → luminance 127 → ink
    expect(packFrame(makeImageData(() => grey(127))).every((b) => b === 0xff))
      .toBe(true);
    // r=g=b=128 → luminance 128 → paper
    expect(packFrame(makeImageData(() => grey(128))).every((b) => b === 0x00))
      .toBe(true);
  });

  it("custom threshold parameter overrides the default", () => {
    const grey200 = makeImageData(() => [200, 200, 200, 255]);
    // Default threshold (128): paper.
    expect(packFrame(grey200).every((b) => b === 0x00)).toBe(true);
    // Override (220): ink.
    expect(packFrame(grey200, 220).every((b) => b === 0xff)).toBe(true);
  });
});

describe("packFrame dimension validation", () => {
  it("rejects images that aren't 800×480", () => {
    const small = makeImageData(() => WHITE, 100, 100);
    expect(() => packFrame(small)).toThrow();
    const wideOnly = makeImageData(() => WHITE, WIDTH, 100);
    expect(() => packFrame(wideOnly)).toThrow();
    const tallOnly = makeImageData(() => WHITE, 100, HEIGHT);
    expect(() => packFrame(tallOnly)).toThrow();
  });
});
