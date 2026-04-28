import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateLegacyLayouts } from "./layoutMigrate";
import {
  _clearAllForTests,
  _resetStoreForTests,
  listLayouts,
  loadLayout,
} from "./layoutStore";
import { defaultsFor, type Element } from "./types";

const LEGACY_V2_KEY = "clapboard.layout.slots";
const LEGACY_V1_KEY = "clapboard.layout.default";

class MockStorage {
  store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

function freshStorage(): MockStorage {
  const ms = new MockStorage();
  (globalThis as unknown as { localStorage: MockStorage }).localStorage = ms;
  return ms;
}

function freshElements(): Element[] {
  return [
    { ...defaultsFor("rect", { x: 10, y: 20 }), id: "a" },
    { ...defaultsFor("text", { x: 30, y: 40 }), id: "b" },
  ];
}

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetStoreForTests();
  freshStorage();
});

afterEach(async () => {
  await _clearAllForTests().catch(() => {});
});

describe("migrateLegacyLayouts (no legacy keys)", () => {
  it("is a no-op when localStorage is empty", async () => {
    const result = await migrateLegacyLayouts();
    expect(result.skipped).toBe(true);
    expect(result.migrated).toEqual([]);
    expect(await listLayouts()).toEqual([]);
  });
});

describe("migrateLegacyLayouts (v2)", () => {
  it("imports each occupied slot as its own v3 layout", async () => {
    const ms = freshStorage();
    ms.setItem(
      LEGACY_V2_KEY,
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          {
            name: "Doc shoot",
            savedAt: 1,
            elements: freshElements(),
            thumbnail: "data:image/png;base64,a",
          },
          null,
          {
            name: "Stunt slate",
            savedAt: 2,
            elements: freshElements(),
            thumbnail: null,
          },
        ],
      }),
    );

    const result = await migrateLegacyLayouts();
    expect(result.skipped).toBe(false);
    expect(result.migrated).toHaveLength(2);

    const list = await listLayouts();
    const names = list.map((e) => e.name).sort();
    expect(names).toEqual(["Doc shoot", "Stunt slate"]);
  });

  it("removes legacy keys so a second call is a no-op", async () => {
    const ms = freshStorage();
    ms.setItem(
      LEGACY_V2_KEY,
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          { name: "x", savedAt: 1, elements: [], thumbnail: null },
          null,
          null,
        ],
      }),
    );
    await migrateLegacyLayouts();
    expect(ms.getItem(LEGACY_V2_KEY)).toBeNull();

    const second = await migrateLegacyLayouts();
    expect(second.skipped).toBe(true);
    expect(await listLayouts()).toHaveLength(1);
  });

  it("runs the Phase-6 image-element migration on legacy slots", async () => {
    const ms = freshStorage();
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
      LEGACY_V2_KEY,
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
    const { migrated } = await migrateLegacyLayouts();
    expect(migrated).toHaveLength(1);
    const round = await loadLayout(migrated[0].id);
    const img = round!.elements[0] as Element & {
      algorithm?: string;
      brightness?: number;
      contrast?: number;
    };
    expect(img.algorithm).toBe("threshold");
    expect(img.brightness).toBe(0);
    expect(img.contrast).toBe(0);
  });

  it("falls back to 'Imported' on a blank slot name", async () => {
    const ms = freshStorage();
    ms.setItem(
      LEGACY_V2_KEY,
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          { name: "  ", savedAt: 1, elements: freshElements(), thumbnail: null },
          null,
          null,
        ],
      }),
    );
    const { migrated } = await migrateLegacyLayouts();
    expect(migrated[0].name).toBe("Imported");
  });

  it("ignores malformed v2 blobs without crashing", async () => {
    const ms = freshStorage();
    ms.setItem(LEGACY_V2_KEY, "not-json");
    const result = await migrateLegacyLayouts();
    expect(result.skipped).toBe(true);
    expect(await listLayouts()).toEqual([]);
    // Malformed legacy blob is preserved on disk — we'd rather
    // surface it than silently delete user data the next session
    // might be able to recover.
    expect(ms.getItem(LEGACY_V2_KEY)).toBe("not-json");
  });
});

describe("migrateLegacyLayouts (v1 only)", () => {
  it("imports the single legacy slot as one v3 layout", async () => {
    const ms = freshStorage();
    ms.setItem(
      LEGACY_V1_KEY,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: 1,
        elements: freshElements(),
      }),
    );
    const { migrated, skipped } = await migrateLegacyLayouts();
    expect(skipped).toBe(false);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].name).toBe("Default");
    expect(ms.getItem(LEGACY_V1_KEY)).toBeNull();
  });
});

describe("migrateLegacyLayouts (v2 + v1 both present)", () => {
  it("prefers v2 and drops both legacy keys", async () => {
    const ms = freshStorage();
    ms.setItem(
      LEGACY_V2_KEY,
      JSON.stringify({
        schemaVersion: 2,
        slots: [
          { name: "v2-slot", savedAt: 1, elements: freshElements(), thumbnail: null },
          null,
          null,
        ],
      }),
    );
    ms.setItem(
      LEGACY_V1_KEY,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: 1,
        elements: [],
      }),
    );
    const { migrated } = await migrateLegacyLayouts();
    expect(migrated).toHaveLength(1);
    expect(migrated[0].name).toBe("v2-slot");
    expect(ms.getItem(LEGACY_V2_KEY)).toBeNull();
    expect(ms.getItem(LEGACY_V1_KEY)).toBeNull();
  });
});
