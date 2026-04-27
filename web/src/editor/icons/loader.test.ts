import { afterEach, describe, expect, it } from "vitest";

import {
  clearIconCacheForTesting,
  getCachedIcon,
  loadIcon,
} from "./loader";
import { loadIconFromDisk, seedAllIconsFromDisk } from "./testIconLoader";

afterEach(() => clearIconCacheForTesting());

describe("loadIconFromDisk (test helper)", () => {
  it("reads a PNG from web/public/icons by registry id", async () => {
    const img = await loadIconFromDisk("film/movie");
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
  });

  it("rejects an unknown id", async () => {
    await expect(loadIconFromDisk("nope/missing")).rejects.toThrow();
  });
});

describe("seedAllIconsFromDisk", () => {
  it("populates the runtime cache so getCachedIcon returns a value", async () => {
    expect(getCachedIcon("film/camera")).toBeUndefined();
    await seedAllIconsFromDisk();
    expect(getCachedIcon("film/camera")).toBeDefined();
  });
});

describe("loadIcon", () => {
  it("rejects an unknown id without caching", async () => {
    await expect(loadIcon("nope/missing")).rejects.toThrow(/unknown icon/);
    expect(getCachedIcon("nope/missing")).toBeUndefined();
  });
});
