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
  /** "fit": scale into 60% of the frame, centered (default).
   *  "background": fit-cover the entire 800×480 frame, push to the
   *  bottom of the layer stack so the user's other elements draw on
   *  top of it.
   */
  mode?: "fit" | "background";
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
  const naturalW = img?.width ?? WIDTH * MAX_FRACTION;
  const naturalH = img?.height ?? HEIGHT * MAX_FRACTION;

  const mode = options.mode ?? "fit";
  let w: number;
  let h: number;
  let position: { x: number; y: number };
  if (mode === "background") {
    // Fit-cover: scale so the smaller axis matches the frame, the
    // larger axis overflows by a few pixels — same idea as
    // background-size: cover. The element bounds may exceed the
    // 800×480 viewport; that's fine, the rasteriser clips on the
    // composite.
    const scale = Math.max(WIDTH / naturalW, HEIGHT / naturalH);
    w = Math.round(naturalW * scale);
    h = Math.round(naturalH * scale);
    position = options.position ?? {
      x: Math.round((WIDTH - w) / 2),
      y: Math.round((HEIGHT - h) / 2),
    };
  } else {
    const scale = Math.min(
      (WIDTH * MAX_FRACTION) / naturalW,
      (HEIGHT * MAX_FRACTION) / naturalH,
      1,
    );
    w = Math.max(8, Math.round(naturalW * scale));
    h = Math.max(8, Math.round(naturalH * scale));
    position = options.position ?? {
      x: Math.round((WIDTH - w) / 2),
      y: Math.round((HEIGHT - h) / 2),
    };
  }

  const store = useEditorStore.getState();
  const id = store.addElement("image", position, { dataUrl, w, h });
  if (mode === "background") {
    // Send to the bottom of the z-stack so any existing text/shapes
    // remain readable on top of the photo.
    store.reorderLayer(id, "bottom");
  }
  return id;
}

// Exposed for tests that don't go through FileReader.
export function _seedCacheForTesting(dataUrl: string, image: unknown): void {
  setCachedImageForTesting(dataUrl, image);
}
