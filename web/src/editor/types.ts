/**
 * Editor element model. A single discriminated union covers `text`, `rect`,
 * and `line`. Common props (`x`, `y`, `w`, `h`, `rotation`, `locked`) live
 * on every element; type-specific props sit alongside.
 *
 * `rotation` is kept on the data model for forward-compat with Phase 4.5,
 * but the Phase 4 UI does NOT expose a rotation handle. The Transformer
 * is configured to suppress the rotate anchor.
 */

export type ElementId = string;

// Free-form CSS font-family string. The two generic-family keywords
// `"sans-serif"` and `"monospace"` are guaranteed to resolve on every
// platform; otherwise the user picks a system-installed family by name
// (enumerated via the Local Font Access API in Chromium-based browsers,
// or typed manually).
export type FontFamily = string;
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export const TEXT_SIZE_PRESETS = [12, 16, 24, 36, 48, 64, 96] as const;
export const MIN_TEXT_SIZE = 6;
export const MAX_TEXT_SIZE = 240;
export type TextSize = number;

export const GENERIC_FONTS: FontFamily[] = ["sans-serif", "monospace"];

export type GroupId = string;

interface BaseElement {
  id: ElementId;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  locked: boolean;
  groupId: GroupId | null;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: TextSize;
  fontFamily: FontFamily;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  bold: boolean;
  italic: boolean;
}

export interface RectElement extends BaseElement {
  type: "rect";
  filled: boolean;
  strokeWidth: number;
}

export interface LineElement extends BaseElement {
  type: "line";
  strokeWidth: number;
}

export interface IconElement extends BaseElement {
  type: "icon";
  // Registry id, e.g. "film/movie" — `<category>/<name>`. Resolves
  // through the icon registry to a public asset path.
  src: string;
  // White-on-black silhouette toggle. On a 1bpp panel, an icon-on-
  // black square sometimes reads better than the outline-on-white
  // default; this flag inverts the rasterised pixels inside the
  // element's bounding box at render time.
  invert: boolean;
}

export interface ImageElement extends BaseElement {
  type: "image";
  // Base64-encoded data URL of the original upload. Phase 5 ships
  // threshold-only binarisation; Phase 6 will add Floyd-Steinberg
  // dither paths reading the same `dataUrl`.
  dataUrl: string;
  // Threshold cutoff in [0, 255]. 128 is centre-grey; lower → more
  // ink, higher → more paper. Lets the user fine-tune contrast on a
  // photo without re-uploading.
  threshold: number;
  // White-on-black inversion, same idiom as IconElement.invert.
  invert: boolean;
}

export type Element =
  | TextElement
  | RectElement
  | LineElement
  | IconElement
  | ImageElement;
export type ElementType = Element["type"];

export const DEFAULT_TEXT_SIZE: TextSize = 24;
export const DEFAULT_FONT_FAMILY: FontFamily = "sans-serif";

/**
 * Wrap a font-family string so it's safe to drop into a CSS shorthand
 * (`ctx.font = "24px <family>"`). Quotes any family that contains a
 * space or non-identifier character; passes generic keywords through
 * unquoted so the CSS engine treats them as the generic family.
 */
export function cssFontFamily(family: FontFamily): string {
  const trimmed = family.trim();
  if (!trimmed) return "sans-serif";
  if (GENERIC_FONTS.includes(trimmed)) return trimmed;
  if (/^[a-zA-Z_][\w-]*$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}
export const DEFAULT_TEXT_ALIGN: TextAlign = "left";
export const DEFAULT_VERTICAL_ALIGN: VerticalAlign = "top";
export const DEFAULT_RECT_STROKE_WIDTH = 2;
export const DEFAULT_LINE_STROKE_WIDTH = 2;
export const DEFAULT_ICON_SIZE = 64;
export const DEFAULT_ICON_SRC = "film/movie";
export const DEFAULT_IMAGE_THRESHOLD = 128;
export const DEFAULT_IMAGE_SIZE = 200;

export function clampTextSize(n: number): TextSize {
  if (!Number.isFinite(n)) return DEFAULT_TEXT_SIZE;
  return Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, Math.round(n)));
}

export function defaultsFor(
  type: ElementType,
  position: { x: number; y: number },
  options: { src?: string; dataUrl?: string; w?: number; h?: number } = {},
): Element {
  const base = {
    id: "",
    x: position.x,
    y: position.y,
    rotation: 0,
    locked: false,
    groupId: null,
  };
  if (type === "icon") {
    return {
      ...base,
      type: "icon",
      w: DEFAULT_ICON_SIZE,
      h: DEFAULT_ICON_SIZE,
      src: options.src ?? DEFAULT_ICON_SRC,
      invert: false,
    };
  }
  if (type === "image") {
    return {
      ...base,
      type: "image",
      w: options.w ?? DEFAULT_IMAGE_SIZE,
      h: options.h ?? DEFAULT_IMAGE_SIZE,
      dataUrl: options.dataUrl ?? "",
      threshold: DEFAULT_IMAGE_THRESHOLD,
      invert: false,
    };
  }
  if (type === "text") {
    return {
      ...base,
      type: "text",
      w: 240,
      h: 40,
      text: "Text",
      fontSize: DEFAULT_TEXT_SIZE,
      fontFamily: DEFAULT_FONT_FAMILY,
      align: DEFAULT_TEXT_ALIGN,
      verticalAlign: DEFAULT_VERTICAL_ALIGN,
      bold: false,
      italic: false,
    };
  }
  if (type === "rect") {
    return {
      ...base,
      type: "rect",
      w: 120,
      h: 80,
      filled: false,
      strokeWidth: DEFAULT_RECT_STROKE_WIDTH,
    };
  }
  return {
    ...base,
    type: "line",
    w: 120,
    h: 0,
    strokeWidth: DEFAULT_LINE_STROKE_WIDTH,
  };
}
