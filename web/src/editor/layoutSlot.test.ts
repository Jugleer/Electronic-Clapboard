import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSlot,
  LayoutQuotaError,
  LayoutSchemaError,
  listSlots,
  loadSlot,
  parseBlob,
  renameSlot,
  saveSlot,
  SLOT_COUNT,
} from "./layoutSlot";
import { defaultsFor, type Element } from "./types";

function freshElements(): Element[] {
  const a = { ...defaultsFor("rect", { x: 10, y: 20 }), id: "a" };
  const b = { ...defaultsFor("text", { x: 30, y: 40 }), id: "b" } as Element & {
    type: "text";
  };
  if (b.type === "text") b.text = "Take 1";
  return [a, b];
}

class MockStorage {
  store = new Map<string, string>();
  quotaBytes = Infinity;
  getItem(k: string) {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    let total = v.length;
    for (const [key, value] of this.store) {
      if (key !== k) total += value.length;
    }
    if (total > this.quotaBytes) {
      const err = new Error("quota exceeded") as Error & { name: string };
      err.name = "QuotaExceededError";
      throw err;
    }
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
}

function freshStorage(): MockStorage {
  const ms = new MockStorage();
  (globalThis as unknown as { localStorage: MockStorage }).localStorage = ms;
  return ms;
}

beforeEach(() => {
  freshStorage();
});

describe("listSlots", () => {
  it("returns three null slots on a fresh storage", () => {
    const slots = listSlots();
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(slots.every((s) => s === null)).toBe(true);
  });
});

describe("saveSlot / loadSlot / clearSlot", () => {
  it("persists a slot and reads it back", () => {
    const before = freshElements();
    saveSlot(0, "Doc shoot", before, "data:image/png;base64,thumb");
    const got = loadSlot(0);
    expect(got?.name).toBe("Doc shoot");
    expect(got?.elements).toEqual(before);
    expect(got?.thumbnail).toBe("data:image/png;base64,thumb");
    expect(typeof got?.savedAt).toBe("number");
  });

  it("treats blank names as the slot's positional fallback", () => {
    saveSlot(1, "   ", freshElements(), null);
    expect(loadSlot(1)?.name).toBe("Slot 2");
  });

  it("clearSlot wipes one slot without affecting others", () => {
    saveSlot(0, "A", freshElements(), null);
    saveSlot(2, "C", freshElements(), null);
    clearSlot(0);
    expect(loadSlot(0)).toBeNull();
    expect(loadSlot(2)?.name).toBe("C");
  });

  it("rejects an out-of-range index", () => {
    expect(() => saveSlot(99, "x", [], null)).toThrow();
    expect(loadSlot(-1)).toBeNull();
  });
});

describe("renameSlot", () => {
  it("updates the name without touching the elements", () => {
    saveSlot(0, "Old", freshElements(), null);
    renameSlot(0, "New name");
    const slot = loadSlot(0);
    expect(slot?.name).toBe("New name");
    expect(slot?.elements).toEqual(freshElements());
  });

  it("is a no-op on an empty slot", () => {
    renameSlot(1, "Whatever");
    expect(loadSlot(1)).toBeNull();
  });
});

describe("schema validation", () => {
  it("rejects non-JSON", () => {
    expect(() => parseBlob("not-json")).toThrow(LayoutSchemaError);
  });

  it("rejects mismatched schemaVersion", () => {
    expect(() =>
      parseBlob(JSON.stringify({ schemaVersion: 1, slots: [] })),
    ).toThrow(/unsupported schema version 1/);
  });

  it("rejects a slots array of the wrong length", () => {
    expect(() =>
      parseBlob(JSON.stringify({ schemaVersion: 2, slots: [null, null] })),
    ).toThrow(/wrong length/);
  });
});

describe("legacy v1 migration", () => {
  it("imports the old single-slot blob into slot 0", () => {
    const ms = freshStorage();
    ms.setItem(
      "clapboard.layout.default",
      JSON.stringify({
        schemaVersion: 1,
        savedAt: Date.now(),
        elements: freshElements(),
      }),
    );
    const slot = loadSlot(0);
    expect(slot?.name).toBe("Default");
    expect(slot?.elements).toEqual(freshElements());
    // Migration also drops the legacy key on the next read.
    expect(ms.getItem("clapboard.layout.default")).toBeNull();
  });
});

describe("phase 6 image-element migration", () => {
  it("patches missing algorithm/brightness/contrast on legacy image elements", () => {
    const ms = freshStorage();
    // A pre-Phase-6 image element: no algorithm, brightness, contrast.
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
    ms.setItem(
      "clapboard.layout.slots",
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          {
            name: "legacy",
            savedAt: 1,
            elements: [legacyImage],
            thumbnail: null,
          },
          null,
          null,
        ],
      }),
    );
    const slot = loadSlot(0);
    const migrated = slot?.elements[0] as {
      algorithm?: string;
      brightness?: number;
      contrast?: number;
      threshold?: number;
    };
    // Legacy elements default to "threshold" so their existing
    // appearance is preserved across the upgrade.
    expect(migrated.algorithm).toBe("threshold");
    expect(migrated.brightness).toBe(0);
    expect(migrated.contrast).toBe(0);
    expect(migrated.threshold).toBe(100);
  });

  it("leaves a fully-specified Phase 6 image element unchanged", () => {
    const ms = freshStorage();
    const phase6Image = {
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
    };
    ms.setItem(
      "clapboard.layout.slots",
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          { name: "fresh", savedAt: 1, elements: [phase6Image], thumbnail: null },
          null,
          null,
        ],
      }),
    );
    const slot = loadSlot(0);
    expect(slot?.elements[0]).toEqual(phase6Image);
  });
});

describe("quota guard", () => {
  it("surfaces a LayoutQuotaError when localStorage rejects a write", () => {
    const ms = freshStorage();
    ms.quotaBytes = 64; // tiny — guarantees the next setItem trips
    expect(() =>
      saveSlot(0, "Big", freshElements(), "data:image/png;base64,a".repeat(100)),
    ).toThrow(LayoutQuotaError);
  });
});
