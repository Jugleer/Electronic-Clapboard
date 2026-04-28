import { describe, expect, it } from "vitest";

import {
  exportFilename,
  filenameSafeName,
  LayoutSchemaError,
  LAYOUT_SCHEMA_VERSION,
  migrateElement,
  newLayoutId,
  parseLayoutRecord,
  validateLayoutRecord,
} from "./layoutSchema";
import { defaultsFor, type Element } from "./types";

function freshElements(): Element[] {
  return [
    { ...defaultsFor("rect", { x: 0, y: 0 }), id: "a" },
    { ...defaultsFor("text", { x: 0, y: 0 }), id: "b" },
  ];
}

describe("schema version constant", () => {
  it("is locked to 3 for Phase 7", () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(3);
  });
});

describe("migrateElement", () => {
  it("patches missing algorithm/brightness/contrast on legacy image elements", () => {
    // A pre-Phase-6 image element with only `threshold` and `invert`.
    const legacy = {
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: "data:image/png;base64,abc",
      threshold: 100,
      invert: false,
    } as unknown as Element;
    const out = migrateElement(legacy) as Element & {
      algorithm?: string;
      brightness?: number;
      contrast?: number;
      threshold?: number;
    };
    expect(out.algorithm).toBe("threshold");
    expect(out.brightness).toBe(0);
    expect(out.contrast).toBe(0);
    expect(out.threshold).toBe(100);
  });

  it("leaves a fully-specified Phase 6 image element unchanged", () => {
    const phase6 = {
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: "data:image/png;base64,abc",
      algorithm: "fs",
      threshold: 128,
      brightness: 5,
      contrast: -10,
      invert: false,
    } as unknown as Element;
    expect(migrateElement(phase6)).toEqual(phase6);
  });

  it("is a no-op for non-image elements", () => {
    const rect = { ...defaultsFor("rect", { x: 0, y: 0 }), id: "r" };
    expect(migrateElement(rect)).toBe(rect);
  });
});

describe("validateLayoutRecord", () => {
  function record(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      id: "id-1",
      name: "Doc shoot",
      savedAt: 1234567890,
      elements: freshElements(),
      thumbnail: null,
      ...overrides,
    };
  }

  it("accepts a well-formed v3 record", () => {
    const out = validateLayoutRecord(record());
    expect(out.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(out.id).toBe("id-1");
    expect(out.name).toBe("Doc shoot");
    expect(out.elements).toHaveLength(2);
  });

  it("rejects null/non-object inputs", () => {
    expect(() => validateLayoutRecord(null)).toThrow(LayoutSchemaError);
    expect(() => validateLayoutRecord(42 as unknown)).toThrow(LayoutSchemaError);
  });

  it("rejects v1 with a clear message", () => {
    expect(() => validateLayoutRecord(record({ schemaVersion: 1 }))).toThrow(
      /unsupported schema version 1/,
    );
  });

  it("rejects v2 with a clear message", () => {
    expect(() => validateLayoutRecord(record({ schemaVersion: 2 }))).toThrow(
      /unsupported schema version 2/,
    );
  });

  it("rejects a future schema version", () => {
    expect(() => validateLayoutRecord(record({ schemaVersion: 99 }))).toThrow(
      /unsupported schema version 99/,
    );
  });

  it("rejects missing id", () => {
    expect(() => validateLayoutRecord(record({ id: "" }))).toThrow(/id/);
  });

  it("rejects non-string name", () => {
    expect(() => validateLayoutRecord(record({ name: 42 }))).toThrow(/name/);
  });

  it("rejects non-numeric savedAt", () => {
    expect(() => validateLayoutRecord(record({ savedAt: "yesterday" }))).toThrow(
      /savedAt/,
    );
  });

  it("rejects non-array elements", () => {
    expect(() => validateLayoutRecord(record({ elements: {} }))).toThrow(
      /elements/,
    );
  });

  it("coerces a non-string thumbnail to null", () => {
    const out = validateLayoutRecord(record({ thumbnail: 42 }));
    expect(out.thumbnail).toBeNull();
  });

  it("runs the Phase-6 element migration on import", () => {
    const legacyImage = {
      id: "img1",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      locked: false,
      groupId: null,
      dataUrl: "data:image/png;base64,abc",
      threshold: 100,
      invert: false,
    };
    const out = validateLayoutRecord(record({ elements: [legacyImage] }));
    const img = out.elements[0] as Element & { algorithm?: string };
    expect(img.algorithm).toBe("threshold");
  });
});

describe("parseLayoutRecord", () => {
  it("rejects non-JSON with a clear message", () => {
    expect(() => parseLayoutRecord("not-json")).toThrow(/not valid JSON/);
  });

  it("round-trips a valid record through JSON", () => {
    const r = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      id: "id-1",
      name: "n",
      savedAt: 1,
      elements: freshElements(),
      thumbnail: null,
    };
    expect(parseLayoutRecord(JSON.stringify(r))).toEqual(r);
  });
});

describe("filenameSafeName / exportFilename", () => {
  it("lowercases and dash-collapses unsafe characters", () => {
    expect(filenameSafeName("Doc Shoot 2026!")).toBe("doc-shoot-2026");
  });

  it("falls back to 'slate' on empty / all-unsafe input", () => {
    expect(filenameSafeName("")).toBe("slate");
    expect(filenameSafeName("...///")).toBe("slate");
  });

  it("trims leading/trailing dashes", () => {
    expect(filenameSafeName("  --hello--  ")).toBe("hello");
  });

  it("formats date as YYYYMMDD", () => {
    // 2026-04-28 in local time. Use a deterministic timestamp built
    // from a Date so the test agrees with whatever local timezone
    // the runner is in (the formatter uses local time intentionally
    // — what the user sees in their file browser).
    const d = new Date(2026, 3, 28, 12, 0, 0);
    expect(exportFilename("My Slate", d.getTime())).toBe(
      "slate-my-slate-20260428.json",
    );
  });
});

describe("newLayoutId", () => {
  it("returns a non-empty string", () => {
    expect(newLayoutId().length).toBeGreaterThan(0);
  });

  it("is unique across calls", () => {
    const a = newLayoutId();
    const b = newLayoutId();
    expect(a).not.toBe(b);
  });
});
