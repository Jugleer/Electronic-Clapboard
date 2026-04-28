import { describe, expect, it } from "vitest";

import {
  CLIPBOARD_KIND,
  CLIPBOARD_VERSION,
  ClipboardParseError,
  parse,
  remap,
  serialise,
  translate,
} from "./clipboard";
import { defaultsFor, type Element } from "./types";

function el(type: "rect" | "text" | "line", x: number, y: number): Element {
  return { ...defaultsFor(type, { x, y }), id: `id-${x}-${y}` };
}

let counter = 0;
const fresh = () => `el_new_${++counter}`;
let gcounter = 0;
const freshGroup = () => `g_new_${++gcounter}`;

describe("serialise / parse round-trip", () => {
  it("preserves the elements array", () => {
    const elements = [el("rect", 10, 20), el("text", 50, 60)];
    const round = parse(serialise(elements));
    expect(round).toEqual(elements);
  });

  it("emits the magic kind + schemaVersion", () => {
    const json = JSON.parse(serialise([el("rect", 0, 0)]));
    expect(json.kind).toBe(CLIPBOARD_KIND);
    expect(json.schemaVersion).toBe(CLIPBOARD_VERSION);
  });
});

describe("parse rejects garbage", () => {
  it("rejects non-JSON", () => {
    expect(() => parse("not-json")).toThrow(ClipboardParseError);
  });
  it("rejects payloads without the magic kind", () => {
    expect(() =>
      parse(JSON.stringify({ schemaVersion: 1, elements: [] })),
    ).toThrow(/not a clapboard payload/);
  });
  it("rejects mismatched schemaVersion", () => {
    expect(() =>
      parse(
        JSON.stringify({ kind: CLIPBOARD_KIND, schemaVersion: 99, elements: [] }),
      ),
    ).toThrow(/unsupported schema version 99/);
  });
  it("rejects payloads with missing elements", () => {
    expect(() =>
      parse(
        JSON.stringify({ kind: CLIPBOARD_KIND, schemaVersion: CLIPBOARD_VERSION }),
      ),
    ).toThrow(/missing elements array/);
  });
});

describe("remap", () => {
  it("gives every pasted element a fresh id", () => {
    counter = 0;
    const inputs = [el("rect", 10, 20), el("text", 30, 40)];
    const out = remap(inputs, fresh, freshGroup);
    expect(new Set(out.map((e) => e.id)).size).toBe(2);
    expect(out.every((e, i) => e.id !== inputs[i].id)).toBe(true);
  });

  it("remaps a shared groupId consistently across siblings", () => {
    counter = 0;
    gcounter = 0;
    const a = { ...el("rect", 0, 0), groupId: "g_old" };
    const b = { ...el("rect", 50, 50), groupId: "g_old" };
    const c = { ...el("rect", 100, 100), groupId: null };
    const out = remap([a, b, c], fresh, freshGroup);
    expect(out[0].groupId).toBe(out[1].groupId);
    expect(out[0].groupId).not.toBe("g_old");
    expect(out[2].groupId).toBeNull();
  });
});

describe("translate", () => {
  it("nudges +10/+10 when target is null", () => {
    const out = translate([el("rect", 100, 50)], null);
    expect(out[0].x).toBe(110);
    expect(out[0].y).toBe(60);
  });

  it("places the union top-left at the target", () => {
    const out = translate(
      [el("rect", 100, 100), el("rect", 200, 150)],
      { x: 0, y: 0 },
    );
    expect(out[0].x).toBe(0);
    expect(out[0].y).toBe(0);
    expect(out[1].x).toBe(100);
    expect(out[1].y).toBe(50);
  });

  it("handles lines via their min-corner bbox", () => {
    const line: Element = {
      id: "l1",
      type: "line",
      x: 100,
      y: 100,
      w: -50,
      h: 30,
      rotation: 0,
      locked: false,
      groupId: null,
      strokeWidth: 2,
    };
    const out = translate([line], { x: 0, y: 0 });
    // Line bbox top-left was (50, 100); after translate the min corner
    // should land at (0, 0) — the line element's `x` shifts by -50 too.
    expect(out[0].x).toBe(50);
    expect(out[0].y).toBe(0);
  });
});
