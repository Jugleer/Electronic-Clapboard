/**
 * Phase 15: template exporter tests.
 *
 * The byte offsets asserted here are the SAME ones asserted in
 * test/test_template_wire/test_template_wire.cpp. That duplication is
 * deliberate: this format has no third implementation to cross-check
 * against (unlike the frame format, which has a Python oracle), so if both
 * codecs drifted together a round-trip test would happily pass. Literal
 * offsets on both sides are what actually pins the contract.
 */

import { describe, expect, it } from "vitest";

import {
  BODY_BYTES,
  MAGIC,
  MAX_REGIONS,
  RASTER_BYTES,
  REGION_BYTES,
  TRAILER_BYTES,
  TRAILER_HEADER,
  VERSION,
  collectRegions,
  encodeTrailer,
  isCanField,
  validateRegions,
  type CanFieldRegion,
} from "./templateExport";
import type { Element, TextElement } from "./types";

function textEl(over: Partial<TextElement> = {}): TextElement {
  return {
    id: over.id ?? "t1",
    type: "text",
    x: 16,
    y: 60,
    w: 380,
    h: 150,
    rotation: 0,
    locked: false,
    groupId: null,
    text: "SCENE 99",
    fontSize: 48,
    fontFamily: "sans-serif",
    align: "left",
    verticalAlign: "middle",
    bold: true,
    italic: false,
    ...over,
  };
}

function region(over: Partial<CanFieldRegion> = {}): CanFieldRegion {
  return {
    fieldId: 0,
    x: 16,
    y: 60,
    w: 380,
    h: 150,
    font: 5,
    halign: "right",
    valign: "bottom",
    invert: true,
    ...over,
  };
}

describe("wire sizes", () => {
  it("match the firmware contract", () => {
    // These appear in the firmware's Content-Length check. If one side moves
    // alone, uploads fail with a length error that explains nothing.
    expect(RASTER_BYTES).toBe(48000);
    expect(REGION_BYTES).toBe(12);
    expect(TRAILER_BYTES).toBe(100);
    expect(BODY_BYTES).toBe(48100);
    expect(MAX_REGIONS).toBe(8);
  });
});

describe("isCanField", () => {
  it("only matches text elements with a field id assigned", () => {
    expect(isCanField(textEl({ canFieldId: 0 }))).toBe(true);
    expect(isCanField(textEl())).toBe(false);

    const rect: Element = {
      id: "r",
      type: "rect",
      x: 0, y: 0, w: 10, h: 10,
      rotation: 0, locked: false, groupId: null,
      filled: true, strokeWidth: 1,
    };
    expect(isCanField(rect)).toBe(false);
  });

  it("treats field id 0 as assigned, not as falsy", () => {
    // The classic bug: `if (el.canFieldId)` drops field 0 silently, and
    // field 0 is the date — so the one field that is always present would
    // be the one that never exports.
    expect(isCanField(textEl({ canFieldId: 0 }))).toBe(true);
  });
});

describe("collectRegions", () => {
  it("sorts by field id regardless of scene order", () => {
    // Stable bytes for a given design: re-stacking layers must not change
    // the exported body, or two identical uploads become un-diffable.
    const els = [
      textEl({ id: "b", canFieldId: 5 }),
      textEl({ id: "a", canFieldId: 1 }),
      textEl({ id: "c", canFieldId: 3 }),
    ];
    expect(collectRegions(els).map((r) => r.fieldId)).toEqual([1, 3, 5]);
  });

  it("rounds fractional geometry rather than truncating", () => {
    const [r] = collectRegions([
      textEl({ canFieldId: 0, x: 99.6, y: 10.2, w: 200.5, h: 40.4 }),
    ]);
    expect(r.x).toBe(100);
    expect(r.y).toBe(10);
    expect(r.w).toBe(201);
    expect(r.h).toBe(40);
  });

  it("defaults to the body font when none is chosen", () => {
    const [r] = collectRegions([textEl({ canFieldId: 0 })]);
    expect(r.font).toBe(4); // SansBold24
  });

  it("ignores static text", () => {
    expect(collectRegions([textEl(), textEl({ id: "x" })])).toEqual([]);
  });
});

describe("validateRegions", () => {
  it("accepts a well-formed set", () => {
    expect(validateRegions([region({ fieldId: 0 }), region({ fieldId: 1, y: 220, h: 40 })]))
      .toEqual([]);
  });

  it("rejects duplicate field ids", () => {
    const errs = validateRegions([region({ fieldId: 2 }), region({ fieldId: 2 })]);
    expect(errs).toContainEqual({ kind: "duplicate-field-id", fieldId: 2 });
  });

  it("rejects a box extending past the panel", () => {
    const errs = validateRegions([region({ fieldId: 0, x: 700, w: 200 })]);
    expect(errs).toContainEqual({ kind: "out-of-bounds", fieldId: 0 });
  });

  it("accepts a box ending exactly at the panel edge", () => {
    expect(validateRegions([region({ fieldId: 0, x: 600, w: 200, y: 0, h: 480 })]))
      .toEqual([]);
  });

  it("rejects zero-area boxes and does not also report them out of bounds", () => {
    // A degenerate box would otherwise trip both checks and show the author
    // two errors for one mistake.
    const errs = validateRegions([region({ fieldId: 0, w: 0 })]);
    expect(errs).toEqual([{ kind: "degenerate", fieldId: 0 }]);
  });

  it("rejects more than MAX_REGIONS fields", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      region({ fieldId: (i % 8) as CanFieldRegion["fieldId"], y: 0, h: 40 }),
    );
    expect(validateRegions(many)).toContainEqual({
      kind: "too-many-fields",
      count: 9,
    });
  });
});

describe("encodeTrailer", () => {
  it("writes the header exactly as the firmware parses it", () => {
    const t = encodeTrailer([region({ fieldId: 0 }), region({ fieldId: 1, y: 220, h: 40 })]);
    expect(t.length).toBe(TRAILER_BYTES);
    expect(t[0]).toBe(0x54); // 'T' — MAGIC 0x4C54 little-endian
    expect(t[1]).toBe(0x4c); // 'L'
    expect(new DataView(t.buffer).getUint16(0, true)).toBe(MAGIC);
    expect(t[2]).toBe(VERSION);
    expect(t[3]).toBe(2); // region_count
  });

  it("writes a region record byte for byte", () => {
    // Mirrors test_region_byte_layout in the firmware suite.
    const t = encodeTrailer([region({ fieldId: 5 })]);
    const o = TRAILER_HEADER;
    expect(t[o + 0]).toBe(5); // field_id
    expect(t[o + 1]).toBe(16); // x = 16 LE
    expect(t[o + 2]).toBe(0);
    expect(t[o + 3]).toBe(60); // y = 60
    expect(t[o + 4]).toBe(0);
    expect(t[o + 5]).toBe(0x7c); // w = 380 = 0x017C
    expect(t[o + 6]).toBe(0x01);
    expect(t[o + 7]).toBe(0x96); // h = 150 = 0x0096
    expect(t[o + 8]).toBe(0x00);
    expect(t[o + 9]).toBe(5); // font
    expect(t[o + 10]).toBe(0x1a); // right(2) | bottom(2)<<2 | invert(0x10)
    expect(t[o + 11]).toBe(0); // reserved
  });

  it("zero-fills unused slots", () => {
    // Keeps the body byte-stable for a given template, so two uploads of the
    // same design are diffable.
    const t = encodeTrailer([region({ fieldId: 0 })]);
    for (let i = TRAILER_HEADER + REGION_BYTES; i < TRAILER_BYTES; i++) {
      expect(t[i]).toBe(0);
    }
  });

  it("round-trips every alignment and invert combination", () => {
    const aligns = ["left", "center", "right"] as const;
    const valigns = ["top", "middle", "bottom"] as const;
    for (let h = 0; h < 3; h++) {
      for (let v = 0; v < 3; v++) {
        for (const inv of [false, true]) {
          const t = encodeTrailer([
            region({ halign: aligns[h], valign: valigns[v], invert: inv }),
          ]);
          const flags = t[TRAILER_HEADER + 10];
          expect(flags & 0x03).toBe(h);
          expect((flags & 0x0c) >> 2).toBe(v);
          expect((flags & 0x10) !== 0).toBe(inv);
        }
      }
    }
  });

  it("caps at MAX_REGIONS even if handed more", () => {
    // Validation should have rejected this already; the encoder must still
    // not write past the fixed 100 bytes.
    const many = Array.from({ length: 12 }, (_, i) =>
      region({ fieldId: (i % 8) as CanFieldRegion["fieldId"] }),
    );
    const t = encodeTrailer(many);
    expect(t.length).toBe(TRAILER_BYTES);
  });
});
