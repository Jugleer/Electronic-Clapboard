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

  /**
   * Phase 15. When set (0–7), this text box is a CAN-driven field rather
   * than static artwork: the robot supplies its content at runtime over
   * CAN3, and the template's exported background leaves the box BLANK.
   *
   * `text` is still meaningful when this is set — it becomes the design-time
   * placeholder shown in the editor so the author can see roughly how much
   * fits. It is deliberately not shipped to the device: baking placeholder
   * text into the raster would leave "SCENE 99" burned behind every real
   * value.
   *
   * Undefined means an ordinary static text element, which is why this is
   * optional rather than `-1`-sentinelled — existing saved layouts load
   * unchanged.
   */
  canFieldId?: CanFieldId;

  /**
   * Which embedded firmware font renders this field on the device. Only
   * meaningful when `canFieldId` is set, because static text is rasterised
   * in the browser with `fontFamily`/`fontSize` and never touches the
   * firmware's font table.
   *
   * The editor cannot use `fontSize` for CAN fields: the device has a closed
   * set of bitmap fonts (region.h FontId), not a scalable one, so an
   * arbitrary px size has nothing to map onto.
   */
  canFontId?: CanFontId;
}

/** Field slots on the wire. protocol.md §8.3 — eight fields, ids 0–7. */
export const CAN_FIELD_IDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export type CanFieldId = (typeof CAN_FIELD_IDS)[number];

/** Max characters a CAN field value may carry. protocol.md §8.3. */
export const CAN_FIELD_MAX_CHARS = 32;

/**
 * Mirrors `region::FontId` in src/region.h. The numeric values are ON THE
 * WIRE (they travel in the template trailer and persist in device flash), so
 * this list may be appended to but never reordered.
 */
export const CAN_FONT_IDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export type CanFontId = (typeof CAN_FONT_IDS)[number];

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

export type DitherAlgorithm = "threshold" | "fs";

export interface ImageElement extends BaseElement {
  type: "image";
  // Base64-encoded data URL of the original upload. Re-rendered every
  // send through the chosen `algorithm`; the editor preview shows the
  // un-binarised source.
  dataUrl: string;
  // Binarisation strategy. `"fs"` runs Floyd-Steinberg and matches
  // PIL's reference output byte-for-byte; `"threshold"` is the
  // simpler hard cut.
  algorithm: DitherAlgorithm;
  // Threshold cutoff in [0, 255], used only when `algorithm === "threshold"`.
  // 128 is centre-grey; lower → more ink, higher → more paper.
  threshold: number;
  // Pre-dither brightness/contrast adjustments, both in [-100, 100]
  // and centred at 0 (= no-op). Applied to the RGBA buffer before
  // grayscale + binarisation.
  brightness: number;
  contrast: number;
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
export const DEFAULT_IMAGE_ALGORITHM: DitherAlgorithm = "fs";
export const DEFAULT_IMAGE_BRIGHTNESS = 0;
export const DEFAULT_IMAGE_CONTRAST = 0;

export function clampTextSize(n: number): TextSize {
  if (!Number.isFinite(n)) return DEFAULT_TEXT_SIZE;
  return Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, Math.round(n)));
}

export function defaultsFor(
  type: ElementType,
  position: { x: number; y: number },
  options: {
    src?: string;
    dataUrl?: string;
    w?: number;
    h?: number;
    algorithm?: DitherAlgorithm;
  } = {},
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
      algorithm: options.algorithm ?? DEFAULT_IMAGE_ALGORITHM,
      threshold: DEFAULT_IMAGE_THRESHOLD,
      brightness: DEFAULT_IMAGE_BRIGHTNESS,
      contrast: DEFAULT_IMAGE_CONTRAST,
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
