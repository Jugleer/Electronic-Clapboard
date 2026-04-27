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
  return backing.getContext("2d");
};
