/**
 * Decoded-image cache for `ImageElement.dataUrl`. Keyed by data URL so
 * duplicates of the same upload share a single decode. The pure 2D-context
 * rasteriser (sync, called from the Send button's onClick) reads through
 * `getCachedImage()`; an async preload runs the moment a new dataUrl
 * lands in the store.
 *
 * In tests, the same swap-the-cache trick the icon path uses applies:
 * @napi-rs/canvas's loadImage decodes a buffer to an Image that
 * `ctx.drawImage` accepts.
 */

type AnyImage = HTMLImageElement | unknown;

const cache = new Map<string, AnyImage>();
const inflight = new Map<string, Promise<AnyImage>>();

async function loadViaImg(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolveImg, rejectImg) => {
    const img = new Image();
    img.onload = () => resolveImg(img);
    img.onerror = () => rejectImg(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

export async function preloadImage(dataUrl: string): Promise<AnyImage> {
  if (!dataUrl) return Promise.reject(new Error("empty dataUrl"));
  const cached = cache.get(dataUrl);
  if (cached) return cached;
  const pending = inflight.get(dataUrl);
  if (pending) return pending;
  const p = loadViaImg(dataUrl)
    .then((img) => {
      cache.set(dataUrl, img);
      inflight.delete(dataUrl);
      return img;
    })
    .catch((err) => {
      inflight.delete(dataUrl);
      throw err;
    });
  inflight.set(dataUrl, p);
  return p;
}

export function getCachedImage(dataUrl: string): AnyImage | undefined {
  return cache.get(dataUrl);
}

export function setCachedImageForTesting(
  dataUrl: string,
  value: AnyImage,
): void {
  cache.set(dataUrl, value);
}

export function clearImageCacheForTesting(): void {
  cache.clear();
  inflight.clear();
}
