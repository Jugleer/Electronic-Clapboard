/**
 * Render a screensaver image URL onto an 800×480 canvas, dither it with
 * Floyd–Steinberg, and POST the resulting frame. Independent of the
 * editor's element pipeline — the screensaver doesn't manipulate the
 * editor store, it just streams pre-baked images.
 *
 * Fit mode is "contain" with white pillarbox/letterbox so non-16:10
 * masters don't get distorted. `?full=1` is forced because dithered
 * photo-like content always benefits from a clean post-saturation pass.
 */

import { floydSteinbergInPlace } from "../editor/dither";
import { HEIGHT, WIDTH } from "../frameFormat";
import { packFrame } from "../packFrame";
import { sendFrame, type SendResult } from "../sendFrame";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`failed to load screensaver image: ${url}`));
    img.src = url;
  });
}

export async function sendScreensaverImage(
  url: string,
  host: string,
): Promise<SendResult> {
  const img = await loadImage(url);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { ok: false, code: "no_context", error: "no 2D context" };
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Contain-fit: scale so the larger axis matches the frame, the
  // smaller axis gets pillarbox/letterbox white margins. Avoids
  // distortion from non-16:10 masters (most Escher prints are squarer).
  const naturalW = img.naturalWidth || img.width || WIDTH;
  const naturalH = img.naturalHeight || img.height || HEIGHT;
  const scale = Math.min(WIDTH / naturalW, HEIGHT / naturalH);
  const dw = Math.round(naturalW * scale);
  const dh = Math.round(naturalH * scale);
  const dx = Math.round((WIDTH - dw) / 2);
  const dy = Math.round((HEIGHT - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);

  const data = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  floydSteinbergInPlace(data, /*invert=*/ false);
  ctx.putImageData(data, 0, 0);

  const bytes = packFrame(ctx.getImageData(0, 0, WIDTH, HEIGHT));
  return sendFrame(bytes, { host, full: true });
}
