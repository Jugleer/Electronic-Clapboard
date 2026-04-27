/**
 * Read a user-supplied image file, decode it to discover its natural
 * dimensions, fit it inside the 800×480 frame, drop it on the editor
 * store at a sensible position, and warm the cache so the rasteriser
 * can render it on the very next frame.
 *
 * Phase 5 ships this as the threshold-only path; Phase 6 will add
 * Floyd-Steinberg dither without changing this entry-point.
 */

import { HEIGHT, WIDTH } from "../frameFormat";
import { preloadImage, setCachedImageForTesting } from "./imageCache";
import { useEditorStore } from "./store";

const MAX_FRACTION = 0.6; // a fresh upload covers up to 60% of either axis

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader produced non-string result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

export interface AddImageOptions {
  position?: { x: number; y: number };
}

export async function addImageFromFile(
  file: File,
  options: AddImageOptions = {},
): Promise<string | null> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`unsupported file type: ${file.type || "(unknown)"}`);
  }
  const dataUrl = await readAsDataUrl(file);
  const img = (await preloadImage(dataUrl)) as
    | { width?: number; height?: number }
    | undefined;
  // Fit the upload into the frame with a margin.
  const naturalW = img?.width ?? WIDTH * MAX_FRACTION;
  const naturalH = img?.height ?? HEIGHT * MAX_FRACTION;
  const scale = Math.min(
    (WIDTH * MAX_FRACTION) / naturalW,
    (HEIGHT * MAX_FRACTION) / naturalH,
    1,
  );
  const w = Math.max(8, Math.round(naturalW * scale));
  const h = Math.max(8, Math.round(naturalH * scale));
  const position = options.position ?? {
    x: Math.round((WIDTH - w) / 2),
    y: Math.round((HEIGHT - h) / 2),
  };
  return useEditorStore
    .getState()
    .addElement("image", position, { dataUrl, w, h });
}

// Exposed for tests that don't go through FileReader.
export function _seedCacheForTesting(dataUrl: string, image: unknown): void {
  setCachedImageForTesting(dataUrl, image);
}
