/**
 * Test-only: load PNG masters from disk via @napi-rs/canvas and seed
 * the runtime cache with images that drawImage knows how to handle. The
 * production loader uses `<img src>`; jsdom's HTMLImageElement doesn't
 * actually fetch, so the test environment substitutes an @napi-rs/canvas
 * Image (which `ctx.drawImage` accepts because the polyfilled context
 * is also @napi-rs/canvas).
 */

import { Image, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { findIcon, ICON_REGISTRY } from "./registry";
import { setCachedIconForTesting, clearIconCacheForTesting } from "./loader";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ICONS = resolve(HERE, "../../../public/icons");

function diskPath(category: string, name: string): string {
  return resolve(PUBLIC_ICONS, category, `${name}.png`);
}

export async function loadIconFromDisk(id: string): Promise<Image> {
  const entry = findIcon(id);
  if (!entry) throw new Error(`unknown icon id: ${id}`);
  const buf = readFileSync(diskPath(entry.category, entry.name));
  return loadImage(buf);
}

export async function seedAllIconsFromDisk(): Promise<void> {
  clearIconCacheForTesting();
  for (const entry of ICON_REGISTRY) {
    const img = await loadIconFromDisk(entry.id);
    setCachedIconForTesting(entry.id, img);
  }
}
