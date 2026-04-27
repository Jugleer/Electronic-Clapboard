import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDefaultLayout,
  hasDefaultLayout,
  LayoutSchemaError,
  loadDefaultLayout,
  parseLayout,
  saveDefaultLayout,
  serializeLayout,
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
  getItem(k: string) {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
}

beforeEach(() => {
  // jsdom provides localStorage automatically when the env is jsdom; the
  // node env here doesn't, so stand one up. Using a fresh mock per test
  // keeps the isolation tight.
  (globalThis as unknown as { localStorage: MockStorage }).localStorage =
    new MockStorage();
});

describe("serializeLayout / parseLayout", () => {
  it("round-trips a list of elements through JSON byte-for-byte", () => {
    const before = freshElements();
    const blob = serializeLayout(before);
    const round = parseLayout(JSON.stringify(blob));
    expect(round.elements).toEqual(before);
    expect(round.schemaVersion).toBe(1);
  });

  it("rejects a non-JSON payload", () => {
    expect(() => parseLayout("nope")).toThrow(LayoutSchemaError);
  });

  it("rejects a wrong schema version with a clear error", () => {
    const stale = JSON.stringify({ schemaVersion: 99, elements: [] });
    expect(() => parseLayout(stale)).toThrow(/unsupported schema version 99/);
  });

  it("rejects a payload that's missing an elements array", () => {
    const broken = JSON.stringify({ schemaVersion: 1 });
    expect(() => parseLayout(broken)).toThrow(/no elements array/);
  });
});

describe("save / load / has / clear default layout", () => {
  it("saves, loads back, and reports presence", () => {
    expect(hasDefaultLayout()).toBe(false);
    expect(loadDefaultLayout()).toBeNull();
    saveDefaultLayout(freshElements());
    expect(hasDefaultLayout()).toBe(true);
    const blob = loadDefaultLayout();
    expect(blob?.elements).toEqual(freshElements());
  });

  it("clear removes the slot", () => {
    saveDefaultLayout(freshElements());
    clearDefaultLayout();
    expect(hasDefaultLayout()).toBe(false);
    expect(loadDefaultLayout()).toBeNull();
  });
});
