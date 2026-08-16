/**
 * Phase 15: mark a text box as a CAN-driven field.
 *
 * A CAN field's content is supplied by the robot at runtime rather than
 * baked into the template, so this panel changes what the element MEANS,
 * not just how it looks. Two consequences the UI has to make visible:
 *
 *   1. The box is exported BLANK. Whatever is in the text box is a
 *      design-time placeholder only.
 *   2. The device renders it with an embedded bitmap font, not the browser
 *      font — so `fontSize`/`fontFamily` stop applying and a device font
 *      must be picked instead.
 *
 * The truncation preview here is the payoff for generating fontMetrics.ts
 * from the firmware's own font headers: the character count and the ellipsis
 * position shown are exactly what the panel will produce.
 */

import type { JSX } from "react";

import { fit, fontLabel } from "./canField";
import { GFX_FONTS } from "./fontMetrics";
import { useEditorStore } from "./store";
import { usePalette } from "./themeStore";
import {
  CAN_FIELD_IDS,
  CAN_FIELD_MAX_CHARS,
  type CanFieldId,
  type CanFontId,
  type TextElement,
} from "./types";

/** Suggested names, purely cosmetic — the wire only carries the index. */
const FIELD_HINTS: Record<CanFieldId, string> = {
  0: "date",
  1: "production",
  2: "scene",
  3: "take",
  4: "description",
  5: "recording #",
  6: "operator",
  7: "notes",
};

export function CanFieldControls({
  element,
}: {
  element: TextElement;
}): JSX.Element {
  const updateText = useEditorStore((s) => s.updateText);
  const elements = useEditorStore((s) => s.elements);
  const palette = usePalette();

  const isField = element.canFieldId !== undefined;
  const fontId: CanFontId = element.canFontId ?? 4;

  // Which ids are already spoken for by another element. Surfacing this in
  // the dropdown beats letting the author pick a duplicate and only finding
  // out at upload time, when the whole template is rejected.
  const taken = new Set<number>();
  for (const el of elements) {
    if (el.type !== "text" || el.id === element.id) continue;
    if (el.canFieldId !== undefined) taken.add(el.canFieldId);
  }

  const preview = isField
    ? fit(element.text, Math.round(element.w), fontId)
    : null;

  const tooTall = GFX_FONTS[fontId].ascent + GFX_FONTS[fontId].descent > element.h;

  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: `1px solid ${palette.buttonBorder}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={isField}
          onChange={(e) =>
            updateText(element.id, {
              // Pick the lowest free id so the common case needs no second
              // decision. undefined (not -1) turns it back into static text.
              canFieldId: e.target.checked
                ? ((CAN_FIELD_IDS.find((i) => !taken.has(i)) ?? 0) as CanFieldId)
                : undefined,
            })
          }
        />
        <span style={{ fontWeight: 600 }}>CAN field</span>
      </label>

      {!isField ? (
        <div style={{ color: palette.textMuted, fontSize: 11 }}>
          Static text, rasterised into the template.
        </div>
      ) : (
        <>
          <div style={{ color: palette.textMuted, fontSize: 11 }}>
            Filled by the robot at runtime. This box exports <b>blank</b>; the
            text below is a preview placeholder only.
          </div>

          <label>
            Field id{" "}
            <select
              value={element.canFieldId}
              onChange={(e) =>
                updateText(element.id, {
                  canFieldId: Number(e.target.value) as CanFieldId,
                })
              }
            >
              {CAN_FIELD_IDS.map((i) => (
                <option key={i} value={i} disabled={taken.has(i)}>
                  {i} — {FIELD_HINTS[i]}
                  {taken.has(i) ? " (in use)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Device font{" "}
            <select
              value={fontId}
              onChange={(e) =>
                updateText(element.id, {
                  canFontId: Number(e.target.value) as CanFontId,
                })
              }
            >
              {GFX_FONTS.map((_, i) => (
                <option key={i} value={i}>
                  {fontLabel(i as CanFontId)}
                </option>
              ))}
            </select>
          </label>

          {tooTall ? (
            <div style={{ color: palette.statusWarn, fontSize: 11 }}>
              Font is {GFX_FONTS[fontId].ascent + GFX_FONTS[fontId].descent}px
              tall but the box is {Math.round(element.h)}px — glyphs will clip
              vertically.
            </div>
          ) : null}

          {preview ? (
            <div
              style={{
                fontSize: 11,
                color: preview.overflowed ? palette.statusWarn : palette.textMuted,
              }}
            >
              {preview.overflowed ? (
                <>
                  Overflows {Math.round(element.w)}px — panel will show:{" "}
                  <code style={{ color: palette.text }}>{preview.rendered}</code>
                </>
              ) : (
                <>
                  Fits: {preview.pixelWidth}px of {Math.round(element.w)}px
                </>
              )}
            </div>
          ) : null}

          {element.text.length > CAN_FIELD_MAX_CHARS ? (
            <div style={{ color: palette.statusWarn, fontSize: 11 }}>
              Placeholder is {element.text.length} chars; the wire carries at
              most {CAN_FIELD_MAX_CHARS}.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
