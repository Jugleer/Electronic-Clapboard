import { beforeEach, describe, expect, it } from "vitest";

import { createEditorStore, type EditorStore } from "./store";

let useStore: ReturnType<typeof createEditorStore>;
const get = (): EditorStore => useStore.getState();

beforeEach(() => {
  useStore = createEditorStore();
});

function rectAt(x: number, y: number, w = 100, h = 50): string {
  const id = get().addElement("rect", { x, y });
  get().resizeElement(id, { x, y, w, h });
  return id;
}

describe("alignSelected — horizontal axis", () => {
  it("left-aligns every selected element to the leftmost x", () => {
    const a = rectAt(50, 0);
    const b = rectAt(100, 100);
    const c = rectAt(200, 200);
    get().selectMany([a, b, c]);
    get().alignSelected("left");
    const xs = get().elements.map((e) => e.x);
    expect(xs).toEqual([50, 50, 50]);
  });

  it("right-aligns every selected element to the rightmost edge", () => {
    const a = rectAt(0, 0, 100, 50);
    const b = rectAt(50, 100, 50, 50);
    get().selectMany([a, b]);
    get().alignSelected("right");
    const els = get().elements;
    // Rightmost edge is a.x + a.w = 100. b should land at 100 - 50 = 50.
    expect(els[0].x + els[0].w).toBe(100);
    expect(els[1].x + els[1].w).toBe(100);
    expect(els[1].x).toBe(50);
  });

  it("centers each element horizontally on the group's vertical centerline", () => {
    const a = rectAt(0, 0, 100, 50);
    const b = rectAt(200, 100, 100, 50);
    // group centerline: ((0 + 100) + (200 + 300)) / 4 = 150
    get().selectMany([a, b]);
    get().alignSelected("center-x");
    const els = get().elements;
    expect(els[0].x + els[0].w / 2).toBe(150);
    expect(els[1].x + els[1].w / 2).toBe(150);
  });
});

describe("alignSelected — vertical axis", () => {
  it("top-aligns to topmost y", () => {
    const a = rectAt(0, 50);
    const b = rectAt(100, 100);
    get().selectMany([a, b]);
    get().alignSelected("top");
    expect(get().elements.map((e) => e.y)).toEqual([50, 50]);
  });

  it("middle-aligns each element on the group's horizontal centerline", () => {
    const a = rectAt(0, 0, 100, 50);
    const b = rectAt(0, 200, 100, 50);
    // group centerline: ((0 + 50) + (200 + 250)) / 4 = 125
    get().selectMany([a, b]);
    get().alignSelected("center-y");
    const els = get().elements;
    expect(els[0].y + els[0].h / 2).toBe(125);
    expect(els[1].y + els[1].h / 2).toBe(125);
  });
});

describe("alignSelected — guards", () => {
  it("is a no-op with fewer than 2 selected elements", () => {
    const a = rectAt(50, 50);
    get().selectElement(a);
    const before = get().elements[0];
    get().alignSelected("left");
    expect(get().elements[0]).toBe(before);
  });

  it("never moves locked elements", () => {
    const a = rectAt(0, 0);
    const b = rectAt(200, 0);
    get().setLocked(b, true);
    get().selectMany([a, b]);
    get().alignSelected("right");
    // b stayed put; a moved to b's right edge.
    expect(get().elements[1].x).toBe(200);
    expect(get().elements[0].x + get().elements[0].w).toBe(300);
  });
});

describe("distributeSelected", () => {
  it("evenly spaces gaps between elements along the horizontal axis", () => {
    // 3 rects at x=0, x=50 (overlapping), x=300, all w=50.
    // Sorted by x → leftmost stays at 0, rightmost at 300, middle
    // distributes so the *gaps* between consecutive boxes are equal.
    const a = rectAt(0, 0, 50, 50);
    const b = rectAt(50, 0, 50, 50);
    const c = rectAt(300, 0, 50, 50);
    get().selectMany([a, b, c]);
    get().distributeSelected("horizontal");
    const els = get().elements;
    // gaps: b.x - (a.x + a.w) === c.x - (b.x + b.w)
    const gap1 = els[1].x - (els[0].x + els[0].w);
    const gap2 = els[2].x - (els[1].x + els[1].w);
    expect(gap1).toBe(gap2);
  });

  it("requires at least 3 selected to do anything", () => {
    const a = rectAt(0, 0);
    const b = rectAt(100, 0);
    get().selectMany([a, b]);
    const before = get().elements;
    get().distributeSelected("horizontal");
    expect(get().elements).toEqual(before);
  });
});
