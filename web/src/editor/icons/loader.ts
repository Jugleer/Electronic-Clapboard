/**
 * Icon image cache. Maps registry id → loaded HTMLImageElement so the
 * pure-2D rasteriser (synchronous; called from the Send button) can
 * `ctx.drawImage` without an `await`. The Konva preview reads the same
 * cache so the interactive view and the wire-bound render share their
 * image source.
 *
 * Loading is async and lazy: `preloadCategory(name)` is invoked the first
 * time the picker expands a category panel. The film category is also
 * preloaded eagerly on App mount so the very first user click adds an
 * icon without a flash of "not loaded yet". A loaded image is shared
 * across all elements pointing at the same id.
 *
 * In tests, jsdom's `<img src>` doesn't actually fetch — the test path
 * uses `loadIconFromBuffer()` against the on-disk PNG via @napi-rs/canvas,
 * matching the rest of the test render pipeline.
 */

import { findIcon, ICON_REGISTRY, type IconCategory } from "./registry";

type AnyImage = HTMLImageElement | unknown;

const cache = new Map<string, AnyImage>();
const inflight = new Map<string, Promise<AnyImage>>();

async function loadViaImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolveImg, rejectImg) => {
    const img = new Image();
    img.onload = () => resolveImg(img);
    img.onerror = (err) =>
      rejectImg(err instanceof Error ? err : new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadIcon(id: string): Promise<AnyImage> {
  const cached = cache.get(id);
  if (cached) return cached;
  const pending = inflight.get(id);
  if (pending) return pending;
  const entry = findIcon(id);
  if (!entry) {
    return Promise.reject(new Error(`unknown icon id: ${id}`));
  }
  const p = loadViaImg(entry.src)
    .then((img) => {
      cache.set(id, img);
      inflight.delete(id);
      return img;
    })
    .catch((err) => {
      inflight.delete(id);
      throw err;
    });
  inflight.set(id, p);
  return p;
}

export async function preloadCategory(category: IconCategory): Promise<void> {
  const ids = ICON_REGISTRY.filter((e) => e.category === category).map((e) => e.id);
  await Promise.all(ids.map((id) => loadIcon(id).catch(() => undefined)));
}

export async function preloadAll(): Promise<void> {
  await Promise.all(
    ICON_REGISTRY.map((e) => loadIcon(e.id).catch(() => undefined)),
  );
}

export function getCachedIcon(id: string): AnyImage | undefined {
  return cache.get(id);
}

export function setCachedIconForTesting(id: string, value: AnyImage): void {
  cache.set(id, value);
}

export function clearIconCacheForTesting(): void {
  cache.clear();
  inflight.clear();
}
