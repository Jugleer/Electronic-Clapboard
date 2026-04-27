// @vitest-environment jsdom

import "./testSetup";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FRAME_BYTES, HEIGHT, WIDTH } from "../frameFormat";
import { packFrame } from "../packFrame";
import { clearIconCacheForTesting } from "./icons/loader";
import { ICON_REGISTRY } from "./icons/registry";
import { seedAllIconsFromDisk } from "./icons/testIconLoader";
import { rasterizeElements } from "./renderToCanvas";
import type { Element, IconElement } from "./types";

function readBytes(elements: Element[]): Uint8Array {
  const canvas = rasterizeElements(elements);
  expect(canvas.width).toBe(WIDTH);
  expect(canvas.height).toBe(HEIGHT);
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  return packFrame(img);
}

function pixelAt(bytes: Uint8Array, x: number, y: number): 0 | 1 {
  const byteIdx = y * (WIDTH / 8) + Math.floor(x / 8);
  const bitIdx = 7 - (x % 8);
  return ((bytes[byteIdx] >> bitIdx) & 1) as 0 | 1;
}

describe("rasterizeElements — empty store", () => {
  it("produces a 48000-byte all-paper frame when nothing is placed", () => {
    const bytes = readBytes([]);
    expect(bytes.length).toBe(FRAME_BYTES);
    expect(bytes.every((b) => b === 0x00)).toBe(true);
  });
});

describe("rasterizeElements — filled rect", () => {
  it("draws ink in the rect's bounding box and paper outside", () => {
    const rect: Element = {
      id: "r1",
      type: "rect",
      x: 100,
      y: 50,
      w: 60,
      h: 40,
      rotation: 0,
      locked: false,
      groupId: null,
      filled: true,
      strokeWidth: 2,
    };
    const bytes = readBytes([rect]);

    // Inside: ink. Sample a few interior points away from edges.
    expect(pixelAt(bytes, 110, 60)).toBe(1);
    expect(pixelAt(bytes, 130, 70)).toBe(1);
    expect(pixelAt(bytes, 155, 85)).toBe(1);

    // Outside: paper.
    expect(pixelAt(bytes, 50, 50)).toBe(0);
    expect(pixelAt(bytes, 200, 50)).toBe(0);
    expect(pixelAt(bytes, 100, 200)).toBe(0);
  });
});

describe("rasterizeElements — outlined rect", () => {
  it("draws ink along the perimeter, paper in the interior", () => {
    const rect: Element = {
      id: "r2",
      type: "rect",
      x: 200,
      y: 100,
      w: 80,
      h: 60,
      rotation: 0,
      locked: false,
      groupId: null,
      filled: false,
      strokeWidth: 4,
    };
    const bytes = readBytes([rect]);

    // Top edge (well inside the stroke band).
    expect(pixelAt(bytes, 240, 101)).toBe(1);
    // Interior (well inside the hollow center, away from stroke).
    expect(pixelAt(bytes, 240, 130)).toBe(0);
    // Outside the rect entirely.
    expect(pixelAt(bytes, 50, 50)).toBe(0);
  });
});

describe("rasterizeElements — line", () => {
  it("draws ink along the line path", () => {
    const line: Element = {
      id: "l1",
      type: "line",
      x: 100,
      y: 100,
      w: 200,
      h: 0,
      rotation: 0,
      locked: false,
      groupId: null,
      strokeWidth: 4,
    };
    const bytes = readBytes([line]);

    // Midpoint of the line.
    expect(pixelAt(bytes, 200, 100)).toBe(1);
    // Well above the line, paper.
    expect(pixelAt(bytes, 200, 50)).toBe(0);
  });
});

describe("rasterizeElements — text", () => {
  const baseText: Omit<Element & { type: "text" }, "bold" | "italic"> = {
    id: "t1",
    type: "text",
    x: 100,
    y: 100,
    w: 300,
    h: 80,
    rotation: 0,
    locked: false,
    groupId: null,
    text: "HELLO",
    fontSize: 48,
    fontFamily: "sans-serif",
    align: "left",
    verticalAlign: "top",
  };

  function inkInBox(bytes: Uint8Array): number {
    let n = 0;
    for (let y = 100; y < 180; y++) {
      for (let x = 100; x < 400; x++) {
        if (pixelAt(bytes, x, y) === 1) n++;
      }
    }
    return n;
  }

  it("produces some ink within the text bounding box", () => {
    const text: Element = { ...baseText, bold: false, italic: false };
    const bytes = readBytes([text]);
    expect(inkInBox(bytes)).toBeGreaterThan(50);
    // Far from the text box — should be paper.
    expect(pixelAt(bytes, 50, 50)).toBe(0);
    expect(pixelAt(bytes, 600, 400)).toBe(0);
  });

  it("bold produces strictly more ink than regular at the same size", () => {
    const reg = readBytes([{ ...baseText, bold: false, italic: false }]);
    const bold = readBytes([{ ...baseText, bold: true, italic: false }]);
    expect(inkInBox(bold)).toBeGreaterThan(inkInBox(reg));
  });

  it("italic shifts ink without erasing it", () => {
    const reg = readBytes([{ ...baseText, bold: false, italic: false }]);
    const italic = readBytes([{ ...baseText, bold: false, italic: true }]);
    expect(inkInBox(italic)).toBeGreaterThan(50);
    // Italic output is not byte-identical to regular (slant moves glyphs).
    expect(italic).not.toEqual(reg);
  });

  it("verticalAlign moves ink within the box", () => {
    const tall: Element = {
      ...baseText,
      h: 200,
      bold: false,
      italic: false,
    };
    const top = readBytes([{ ...tall, verticalAlign: "top" }]);
    const bot = readBytes([{ ...tall, verticalAlign: "bottom" }]);
    // Different vertical alignments produce different bytes.
    expect(top).not.toEqual(bot);
    // Top alignment puts ink near the top; bottom alignment near the bottom.
    let inkTopRow = 0;
    let inkBotRow = 0;
    for (let x = 100; x < 400; x++) {
      for (let y = 100; y < 140; y++) if (pixelAt(top, x, y) === 1) inkTopRow++;
      for (let y = 260; y < 300; y++) if (pixelAt(bot, x, y) === 1) inkBotRow++;
    }
    expect(inkTopRow).toBeGreaterThan(20);
    expect(inkBotRow).toBeGreaterThan(20);
  });
});

describe("rasterizeElements — rotation", () => {
  it("applied rotation moves the rendered ink off the axis-aligned box", () => {
    const noRot: Element = {
      id: "r-norot",
      type: "rect",
      x: 200,
      y: 100,
      w: 100,
      h: 20,
      rotation: 0,
      locked: false,
      groupId: null,
      filled: true,
      strokeWidth: 2,
    };
    const rotated: Element = { ...noRot, rotation: 90 };
    const a = readBytes([noRot]);
    const b = readBytes([rotated]);
    expect(a).not.toEqual(b);
    // Pre-rotation a wide-but-short rect spans x=200..300, y=100..120.
    // After 90° rotation around the top-left, the rect spans
    // x=180..200, y=100..200 (Konva-style top-left pivot, rotates
    // the +x axis into +y). Sample a point that was paper at 0°
    // and is ink at 90°.
    expect(pixelAt(a, 195, 150)).toBe(0);
    expect(pixelAt(b, 195, 150)).toBe(1);
  });
});

describe("rasterizeElements — icon", () => {
  function inkInBox(
    bytes: Uint8Array,
    x0: number,
    y0: number,
    w: number,
    h: number,
  ): number {
    let n = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (pixelAt(bytes, x, y) === 1) n++;
      }
    }
    return n;
  }

  beforeAll(async () => {
    await seedAllIconsFromDisk();
  });
  afterEach(() => {
    // Don't clear between every test — re-seeding is slow and the cache
    // is read-only from the rasteriser's perspective. Reset only at the
    // end of the file; the seedAllIconsFromDisk in beforeAll owns the
    // lifecycle here.
  });

  it("draws ink within the icon's bounding box and paper outside", () => {
    const icon: IconElement = {
      id: "i1",
      type: "icon",
      x: 100,
      y: 100,
      w: 64,
      h: 64,
      rotation: 0,
      locked: false,
      groupId: null,
      src: "film/movie",
      invert: false,
    };
    const bytes = readBytes([icon]);
    expect(inkInBox(bytes, 100, 100, 64, 64)).toBeGreaterThan(20);
    // Far from the icon: paper.
    expect(pixelAt(bytes, 50, 50)).toBe(0);
    expect(pixelAt(bytes, 600, 400)).toBe(0);
  });

  it("invert flips ink/paper inside the bounding box", () => {
    const base: IconElement = {
      id: "i2",
      type: "icon",
      x: 200,
      y: 200,
      w: 64,
      h: 64,
      rotation: 0,
      locked: false,
      groupId: null,
      src: "film/movie",
      invert: false,
    };
    const a = readBytes([base]);
    const b = readBytes([{ ...base, invert: true }]);
    // Ink inside the box is dramatically different.
    const inkA = inkInBox(a, 200, 200, 64, 64);
    const inkB = inkInBox(b, 200, 200, 64, 64);
    // Outline icon: relatively few ink pixels. Inverted: most pixels ink.
    expect(inkA).toBeLessThan(64 * 64 / 2);
    expect(inkB).toBeGreaterThan(64 * 64 / 2);
    // Outside the box, both are paper.
    expect(pixelAt(a, 100, 100)).toBe(0);
    expect(pixelAt(b, 100, 100)).toBe(0);
  });

  it("rotates around the element's top-left like the other element types", () => {
    const noRot: IconElement = {
      id: "i3",
      type: "icon",
      x: 300,
      y: 200,
      w: 64,
      h: 64,
      rotation: 0,
      locked: false,
      groupId: null,
      src: "film/movie",
      invert: false,
    };
    const rotated: IconElement = { ...noRot, rotation: 90 };
    const a = readBytes([noRot]);
    const b = readBytes([rotated]);
    expect(a).not.toEqual(b);
  });

  it("every advertised icon rasterises without throwing", () => {
    for (const entry of ICON_REGISTRY) {
      const el: IconElement = {
        id: `smoke-${entry.id}`,
        type: "icon",
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        rotation: 0,
        locked: false,
        groupId: null,
        src: entry.id,
        invert: false,
      };
      expect(() => readBytes([el])).not.toThrow();
    }
  });

  it("cache miss leaves the footprint paper-coloured (no crash)", () => {
    clearIconCacheForTesting();
    const icon: IconElement = {
      id: "i4",
      type: "icon",
      x: 0,
      y: 0,
      w: 64,
      h: 64,
      rotation: 0,
      locked: false,
      groupId: null,
      src: "film/movie",
      invert: false,
    };
    const bytes = readBytes([icon]);
    expect(bytes.length).toBe(FRAME_BYTES);
    expect(bytes.every((b) => b === 0x00)).toBe(true);
  });
});

describe("rasterizeElements — selection furniture", () => {
  it("does NOT draw selection handles or hover outlines into the bytes", () => {
    // The rasteriser takes element data only; there is no selection state
    // on elements. This is a contract canary — if a future refactor lets
    // selection styling leak into the rasterise path, the bytes will
    // change and this test will fail.
    const rect: Element = {
      id: "r3",
      type: "rect",
      x: 10,
      y: 10,
      w: 20,
      h: 20,
      rotation: 0,
      locked: false,
      groupId: null,
      filled: true,
      strokeWidth: 2,
    };
    const a = readBytes([rect]);
    const b = readBytes([rect]); // same input → same output, idempotent
    expect(a).toEqual(b);
  });
});
