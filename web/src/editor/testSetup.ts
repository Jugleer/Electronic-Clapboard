/**
 * Jsdom doesn't ship a 2D canvas implementation. Polyfill
 * `HTMLCanvasElement.prototype.getContext("2d")` to delegate to
 * @napi-rs/canvas (Skia under the hood, prebuilt Windows binaries).
 *
 * Loaded by the `// @vitest-environment jsdom` test files via Vitest's
 * setup-file mechanism is overkill for one test, so each canvas-using test
 * imports this file at the top instead. Idempotent — safe to import many
 * times.
 */

import { createCanvas } from "@napi-rs/canvas";

const KEY = "__napi_canvas__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCanvas = any;

const realGetContext = HTMLCanvasElement.prototype.getContext;

// Unwrap a jsdom HTMLCanvasElement to its backing @napi-rs canvas so
// `ctx.drawImage(otherCanvas, ...)` works across the polyfill seam.
// Without this, drawImage rejects the jsdom element since it isn't
// an @napi-rs Canvas, Image, or SVG.
function unwrap(arg: unknown): unknown {
  if (
    typeof HTMLCanvasElement !== "undefined" &&
    arg instanceof HTMLCanvasElement
  ) {
    const backing = (arg as HTMLCanvasElement & { [KEY]?: AnyCanvas })[KEY];
    return backing ?? arg;
  }
  return arg;
}

HTMLCanvasElement.prototype.getContext = function patched(
  this: HTMLCanvasElement & { [KEY]?: AnyCanvas },
  contextId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (contextId !== "2d") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (realGetContext as any).call(this, contextId, options);
  }
  const w = this.width || 1;
  const h = this.height || 1;
  let backing = this[KEY] as AnyCanvas | undefined;
  if (!backing || backing.width !== w || backing.height !== h) {
    backing = createCanvas(w, h);
    this[KEY] = backing;
  }
  const ctx = backing.getContext("2d");
  if (ctx && !ctx.__patchedDrawImage) {
    const realDrawImage = ctx.drawImage.bind(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.drawImage = (...args: any[]) => {
      args[0] = unwrap(args[0]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (realDrawImage as any)(...args);
    };
    ctx.__patchedDrawImage = true;
  }
  return ctx;
};
