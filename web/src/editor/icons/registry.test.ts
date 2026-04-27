import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findIcon,
  ICON_CATEGORIES,
  ICON_REGISTRY,
  iconsInCategory,
} from "./registry";

const HERE = dirname(fileURLToPath(import.meta.url));
// web/public/icons relative to this test file: ../../../public/icons
const PUBLIC_ICONS = resolve(HERE, "../../../public/icons");

describe("icon registry", () => {
  it("lists at least 25 film icons (the v1 plan minimum)", () => {
    const film = iconsInCategory("film");
    expect(film.length).toBeGreaterThanOrEqual(25);
  });

  it("has entries in every advertised category", () => {
    for (const c of ICON_CATEGORIES) {
      expect(iconsInCategory(c.id).length).toBeGreaterThan(0);
    }
  });

  it("uses unique ids, formatted as `<category>/<name>`", () => {
    const seen = new Set<string>();
    for (const e of ICON_REGISTRY) {
      expect(e.id).toBe(`${e.category}/${e.name}`);
      expect(seen.has(e.id)).toBe(false);
      seen.add(e.id);
    }
  });

  it("findIcon returns the canonical entry, or null for unknown ids", () => {
    expect(findIcon("film/movie")?.label).toBe("Clapboard");
    expect(findIcon("nope/not-a-thing")).toBeNull();
  });

  it("every advertised src points at a committed PNG on disk", () => {
    expect(existsSync(PUBLIC_ICONS)).toBe(true);
    for (const e of ICON_REGISTRY) {
      const path = resolve(PUBLIC_ICONS, e.category, `${e.name}.png`);
      expect(existsSync(path), `missing ${e.id} → ${path}`).toBe(true);
    }
  });

  it("no orphan PNGs in public/icons (registry covers the asset dir)", () => {
    const advertised = new Set(ICON_REGISTRY.map((e) => `${e.category}/${e.name}.png`));
    for (const c of ICON_CATEGORIES) {
      const dir = resolve(PUBLIC_ICONS, c.id);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".png")) continue;
        const key = `${c.id}/${f}`;
        expect(advertised.has(key), `orphan icon on disk: ${key}`).toBe(true);
      }
    }
  });
});
