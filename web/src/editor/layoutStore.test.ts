// IndexedDB-backed store, exercised through fake-indexeddb. Each
// test starts with a fresh in-memory IDB so id collisions and
// leftover entries don't bleed across cases.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _clearAllForTests,
  _resetStoreForTests,
  deleteLayout,
  exportLayoutJson,
  importLayoutJson,
  LayoutSchemaError,
  LAYOUT_SCHEMA_VERSION,
  listLayouts,
  loadLayout,
  renameLayout,
  saveLayout,
} from "./layoutStore";
import { defaultsFor, type Element } from "./types";

function freshElements(): Element[] {
  return [
    { ...defaultsFor("rect", { x: 10, y: 20 }), id: "a" },
    { ...defaultsFor("text", { x: 30, y: 40 }), id: "b" },
  ];
}

beforeEach(async () => {
  // Hand each test a fresh IDBFactory so previous DB state can't
  // leak through. fake-indexeddb wires the global `indexedDB` to
  // whatever we assign here.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetStoreForTests();
});

afterEach(async () => {
  await _clearAllForTests().catch(() => {});
});

describe("listLayouts (fresh DB)", () => {
  it("returns an empty array", async () => {
    expect(await listLayouts()).toEqual([]);
  });
});

describe("saveLayout / loadLayout round-trip", () => {
  it("persists a fresh layout and reads it back", async () => {
    const elements = freshElements();
    const saved = await saveLayout({
      name: "Doc shoot",
      elements,
      thumbnail: "data:image/png;base64,thumb",
    });
    expect(saved.id).toBeTruthy();
    expect(saved.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(saved.name).toBe("Doc shoot");
    expect(typeof saved.savedAt).toBe("number");

    const got = await loadLayout(saved.id);
    expect(got?.name).toBe("Doc shoot");
    expect(got?.elements).toEqual(elements);
    expect(got?.thumbnail).toBe("data:image/png;base64,thumb");
  });

  it("falls back to 'Untitled' on a blank/whitespace name", async () => {
    const saved = await saveLayout({
      name: "   ",
      elements: freshElements(),
      thumbnail: null,
    });
    expect(saved.name).toBe("Untitled");
  });

  it("returns null when loading a missing id", async () => {
    expect(await loadLayout("nonexistent")).toBeNull();
  });

  it("overwrites when an existing id is provided", async () => {
    const first = await saveLayout({
      name: "v1",
      elements: freshElements(),
      thumbnail: null,
    });
    const second = await saveLayout({
      id: first.id,
      name: "v2",
      elements: [],
      thumbnail: null,
    });
    expect(second.id).toBe(first.id);
    const got = await loadLayout(first.id);
    expect(got?.name).toBe("v2");
    expect(got?.elements).toEqual([]);
    expect(await listLayouts()).toHaveLength(1);
  });
});

describe("listLayouts ordering + summary shape", () => {
  it("orders newest savedAt first", async () => {
    const a = await saveLayout({
      name: "old",
      elements: [],
      thumbnail: null,
    });
    // Force a measurable savedAt gap.
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveLayout({
      name: "newer",
      elements: [],
      thumbnail: null,
    });

    const list = await listLayouts();
    expect(list.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("only returns the summary fields (no elements)", async () => {
    await saveLayout({
      name: "x",
      elements: freshElements(),
      thumbnail: "thumb",
    });
    const [entry] = await listLayouts();
    expect(Object.keys(entry).sort()).toEqual(
      ["id", "name", "savedAt", "thumbnail"].sort(),
    );
  });
});

describe("renameLayout", () => {
  it("updates the name on disk and in the index", async () => {
    const saved = await saveLayout({
      name: "Old",
      elements: freshElements(),
      thumbnail: null,
    });
    await renameLayout(saved.id, "New");
    const got = await loadLayout(saved.id);
    expect(got?.name).toBe("New");
    const [entry] = await listLayouts();
    expect(entry.name).toBe("New");
    // Elements survive the rename unchanged.
    expect(got?.elements).toEqual(freshElements());
  });

  it("rejects an empty name with a clear error", async () => {
    const saved = await saveLayout({
      name: "x",
      elements: [],
      thumbnail: null,
    });
    await expect(renameLayout(saved.id, "   ")).rejects.toBeInstanceOf(
      LayoutSchemaError,
    );
  });

  it("is a no-op on a missing id", async () => {
    await renameLayout("missing", "anything");
    expect(await listLayouts()).toEqual([]);
  });
});

describe("deleteLayout", () => {
  it("removes from both the layout map and the index", async () => {
    const a = await saveLayout({ name: "a", elements: [], thumbnail: null });
    const b = await saveLayout({ name: "b", elements: [], thumbnail: null });
    await deleteLayout(a.id);
    expect(await loadLayout(a.id)).toBeNull();
    const list = await listLayouts();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.id);
  });

  it("is idempotent on a missing id", async () => {
    await deleteLayout("nope");
    expect(await listLayouts()).toEqual([]);
  });
});

describe("export / import round-trip", () => {
  it("export produces a v3 JSON blob with the saved fields", async () => {
    const saved = await saveLayout({
      name: "My Slate",
      elements: freshElements(),
      thumbnail: null,
    });
    const exp = await exportLayoutJson(saved.id);
    expect(exp).not.toBeNull();
    expect(exp?.filename).toMatch(/^slate-my-slate-\d{8}\.json$/);
    const parsed = JSON.parse(exp!.json) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(parsed.name).toBe("My Slate");
    expect(parsed.elements).toEqual(freshElements());
  });

  it("import-then-load matches the original elements", async () => {
    const original = await saveLayout({
      name: "RoundTrip",
      elements: freshElements(),
      thumbnail: null,
    });
    const exp = await exportLayoutJson(original.id);
    expect(exp).not.toBeNull();

    // Wipe the DB to simulate moving the JSON to a fresh machine.
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    _resetStoreForTests();

    const imported = await importLayoutJson(exp!.json);
    expect(imported.name).toBe("RoundTrip");
    const round = await loadLayout(imported.id);
    expect(round?.elements).toEqual(freshElements());
  });

  it("import mints a fresh id by default so re-importing the same file makes two layouts", async () => {
    const saved = await saveLayout({
      name: "twin",
      elements: [],
      thumbnail: null,
    });
    const exp = await exportLayoutJson(saved.id);
    const second = await importLayoutJson(exp!.json);
    expect(second.id).not.toBe(saved.id);
    expect(await listLayouts()).toHaveLength(2);
  });

  it("import preserves id when freshId: false is passed", async () => {
    const saved = await saveLayout({
      name: "twin",
      elements: [],
      thumbnail: null,
    });
    const exp = await exportLayoutJson(saved.id);
    const second = await importLayoutJson(exp!.json, { freshId: false });
    expect(second.id).toBe(saved.id);
    // It overwrote rather than duplicating.
    expect(await listLayouts()).toHaveLength(1);
  });

  it("rejects garbage JSON with a user-readable message", async () => {
    await expect(importLayoutJson("nope, not json")).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("rejects v2 with a clear message", async () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      slots: [null, null, null],
    });
    await expect(importLayoutJson(v2)).rejects.toThrow(
      /unsupported schema version 2/,
    );
  });

  it("rejects v1 with a clear message", async () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      savedAt: 1,
      elements: [],
    });
    await expect(importLayoutJson(v1)).rejects.toThrow(
      /unsupported schema version 1/,
    );
  });

  it("rejects a future schema version", async () => {
    const future = JSON.stringify({
      schemaVersion: 99,
      id: "x",
      name: "y",
      savedAt: 1,
      elements: [],
      thumbnail: null,
    });
    await expect(importLayoutJson(future)).rejects.toThrow(
      /unsupported schema version 99/,
    );
  });

  it("returns null when exporting a missing id", async () => {
    expect(await exportLayoutJson("nope")).toBeNull();
  });
});

describe("orphan reconciliation", () => {
  it("hydrates a summary for a layout whose index row was lost", async () => {
    // Save normally, then nuke the index entry to mimic a half-completed
    // save (browser killed between idbSet(layout) and idbSet(index)).
    const saved = await saveLayout({
      name: "orphan",
      elements: freshElements(),
      thumbnail: null,
    });
    // Use the underlying idb-keyval primitives via a direct delete
    // of the __index entry.
    const { del } = await import("idb-keyval");
    const { createStore } = await import("idb-keyval");
    const s = createStore("clapboard-layouts", "layouts");
    await del("__index", s);

    const list = await listLayouts();
    expect(list.map((e) => e.id)).toEqual([saved.id]);
    expect(list[0].name).toBe("orphan");
  });
});
