import { ICON_CATEGORIES, ICON_REGISTRY } from "./icons/registry";
import { useEditorStore } from "./store";
import { usePalette } from "./themeStore";
import {
  clampTextSize,
  cssFontFamily,
  GENERIC_FONTS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_SIZE_PRESETS,
  type DitherAlgorithm,
  type FontFamily,
  type TextAlign,
  type VerticalAlign,
} from "./types";
import { useSystemFonts } from "./useSystemFonts";

const ALIGNS: TextAlign[] = ["left", "center", "right"];
const VERTICAL_ALIGNS: VerticalAlign[] = ["top", "middle", "bottom"];

export function PropertiesPanel(): JSX.Element {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const elements = useEditorStore((s) => s.elements);
  const element =
    selectedIds.length === 1
      ? elements.find((e) => e.id === selectedIds[0]) ?? null
      : null;
  const updateText = useEditorStore((s) => s.updateText);
  const updateRect = useEditorStore((s) => s.updateRect);
  const updateLine = useEditorStore((s) => s.updateLine);
  const updateIcon = useEditorStore((s) => s.updateIcon);
  const updateImage = useEditorStore((s) => s.updateImage);
  const rotateElement = useEditorStore((s) => s.rotateElement);
  const fonts = useSystemFonts();
  const palette = usePalette();

  return (
    <div
      style={{
        border: `1px solid ${palette.panelBorder}`,
        background: palette.panelBg,
        color: palette.text,
        padding: 8,
        minWidth: 260,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, color: palette.textHeading }}>
        Properties
      </div>
      {selectedIds.length === 0 ? (
        <div style={{ color: palette.textMuted }}>Select an element.</div>
      ) : selectedIds.length > 1 ? (
        <div style={{ color: palette.text }}>
          {selectedIds.length} elements selected — group move/delete/duplicate
          available; per-element styling requires a single selection.
        </div>
      ) : !element ? null : element.type === "text" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label>
            Text
            <textarea
              value={element.text}
              onChange={(e) => updateText(element.id, { text: e.target.value })}
              rows={3}
              style={{ width: "100%", fontFamily: element.fontFamily, fontSize: 13 }}
            />
          </label>
          <label>
            Size{" "}
            <input
              type="number"
              min={MIN_TEXT_SIZE}
              max={MAX_TEXT_SIZE}
              step={1}
              list="text-size-presets"
              value={element.fontSize}
              onChange={(e) =>
                updateText(element.id, { fontSize: clampTextSize(Number(e.target.value)) })
              }
              style={{ width: 70 }}
            />{" "}
            px
            <datalist id="text-size-presets">
              {TEXT_SIZE_PRESETS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            Font{" "}
            <input
              type="text"
              list="system-fonts"
              value={element.fontFamily}
              onChange={(e) =>
                updateText(element.id, { fontFamily: e.target.value as FontFamily })
              }
              style={{
                fontFamily: cssFontFamily(element.fontFamily),
                minWidth: 160,
              }}
              placeholder="sans-serif"
            />
            <datalist id="system-fonts">
              {GENERIC_FONTS.map((f) => (
                <option key={f} value={f} />
              ))}
              {fonts.families.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          {fonts.supported && fonts.status !== "ready" ? (
            <button
              type="button"
              onClick={() => void fonts.request()}
              disabled={fonts.status === "loading"}
              style={{ padding: "4px 8px", fontSize: 12 }}
              title="Reads the list of fonts installed on this OS (browser permission prompt)"
            >
              {fonts.status === "loading"
                ? "Loading system fonts…"
                : fonts.status === "denied"
                  ? "Permission denied — retry"
                  : "Load system fonts"}
            </button>
          ) : null}
          {!fonts.supported ? (
            <div style={{ color: palette.textMuted, fontSize: 11 }}>
              Local Font Access unavailable in this browser — type any
              installed font name and it will be used if the OS resolves
              it.
            </div>
          ) : null}
          {fonts.status === "ready" ? (
            <div style={{ color: palette.statusOk, fontSize: 11 }}>
              {fonts.families.length} system fonts available.
            </div>
          ) : null}
          <label>
            Align{" "}
            <select
              value={element.align}
              onChange={(e) =>
                updateText(element.id, { align: e.target.value as TextAlign })
              }
            >
              {ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vertical{" "}
            <select
              value={element.verticalAlign}
              onChange={(e) =>
                updateText(element.id, { verticalAlign: e.target.value as VerticalAlign })
              }
            >
              {VERTICAL_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              aria-pressed={element.bold}
              onClick={() => updateText(element.id, { bold: !element.bold })}
              title="Bold"
              style={{
                padding: "2px 10px",
                fontWeight: "bold",
                color: palette.text,
                background: element.bold ? palette.buttonBgActive : palette.buttonBg,
                border: `1px solid ${element.bold ? palette.link : palette.buttonBorder}`,
                minWidth: 32,
              }}
            >
              B
            </button>
            <button
              type="button"
              aria-pressed={element.italic}
              onClick={() => updateText(element.id, { italic: !element.italic })}
              title="Italic"
              style={{
                padding: "2px 10px",
                fontStyle: "italic",
                color: palette.text,
                background: element.italic ? palette.buttonBgActive : palette.buttonBg,
                border: `1px solid ${element.italic ? palette.link : palette.buttonBorder}`,
                minWidth: 32,
              }}
            >
              I
            </button>
          </div>
        </div>
      ) : element.type === "image" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label>
            Algorithm{" "}
            <select
              value={element.algorithm}
              onChange={(e) =>
                updateImage(element.id, {
                  algorithm: e.target.value as DitherAlgorithm,
                })
              }
            >
              <option value="fs">Floyd-Steinberg</option>
              <option value="threshold">Threshold</option>
            </select>
          </label>
          {element.algorithm === "threshold" ? (
            <label>
              Threshold{" "}
              <input
                type="range"
                min={1}
                max={254}
                step={1}
                value={element.threshold}
                onChange={(e) =>
                  updateImage(element.id, { threshold: Number(e.target.value) })
                }
                style={{ width: 140 }}
              />{" "}
              <span style={{ color: palette.textMuted, fontVariantNumeric: "tabular-nums" }}>
                {element.threshold}
              </span>
            </label>
          ) : null}
          <label>
            Brightness{" "}
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={element.brightness}
              onChange={(e) =>
                updateImage(element.id, { brightness: Number(e.target.value) })
              }
              style={{ width: 140 }}
            />{" "}
            <span style={{ color: palette.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {element.brightness}
            </span>
          </label>
          <label>
            Contrast{" "}
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={element.contrast}
              onChange={(e) =>
                updateImage(element.id, { contrast: Number(e.target.value) })
              }
              style={{ width: 140 }}
            />{" "}
            <span style={{ color: palette.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {element.contrast}
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={element.invert}
              onChange={(e) => updateImage(element.id, { invert: e.target.checked })}
            />{" "}
            Invert
          </label>
          <div style={{ color: palette.textMuted, fontSize: 11 }}>
            Preview shows the un-dithered source — click Send to see
            the actual {element.algorithm === "fs" ? "Floyd-Steinberg" : "thresholded"}{" "}
            output on the panel.
          </div>
        </div>
      ) : element.type === "icon" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label>
            Icon{" "}
            <select
              value={element.src}
              onChange={(e) => updateIcon(element.id, { src: e.target.value })}
              style={{ minWidth: 180 }}
            >
              {ICON_CATEGORIES.map((cat) => (
                <optgroup key={cat.id} label={cat.label}>
                  {ICON_REGISTRY.filter((e) => e.category === cat.id).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={element.invert}
              onChange={(e) => updateIcon(element.id, { invert: e.target.checked })}
            />{" "}
            Invert ink
          </label>
          <div style={{ color: palette.textMuted, fontSize: 11 }}>
            Icons have transparent backgrounds — invert flips the
            stroke from black to white without filling the surround.
            Preview dims to 50% as a hint; click Send to see the
            result on the panel.
          </div>
        </div>
      ) : element.type === "rect" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label>
            <input
              type="checkbox"
              checked={element.filled}
              onChange={(e) => updateRect(element.id, { filled: e.target.checked })}
            />{" "}
            Filled
          </label>
          <label>
            Stroke width{" "}
            <input
              type="number"
              min={1}
              max={20}
              value={element.strokeWidth}
              onChange={(e) =>
                updateRect(element.id, { strokeWidth: Math.max(1, Number(e.target.value)) })
              }
              style={{ width: 60 }}
              disabled={element.filled}
            />
          </label>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label>
            Stroke width{" "}
            <input
              type="number"
              min={1}
              max={20}
              value={element.strokeWidth}
              onChange={(e) =>
                updateLine(element.id, { strokeWidth: Math.max(1, Number(e.target.value)) })
              }
              style={{ width: 60 }}
            />
          </label>
        </div>
      )}
      {element && element.type !== "line" ? (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
            Rotate{" "}
            <input
              type="number"
              min={-360}
              max={360}
              step={1}
              value={Math.round(element.rotation)}
              onChange={(e) =>
                rotateElement(element.id, Number(e.target.value) || 0)
              }
              style={{ width: 60 }}
              disabled={element.locked}
            />{" "}
            °
          </label>
          <button
            type="button"
            onClick={() => rotateElement(element.id, 0)}
            disabled={element.locked}
            style={{ padding: "2px 8px", fontSize: 12 }}
            title="Reset rotation to 0°"
          >
            reset
          </button>
        </div>
      ) : null}
      {element ? (
        <div style={{ marginTop: 10, color: palette.textMuted, fontSize: 11 }}>
          {Math.round(element.x)}, {Math.round(element.y)} ·{" "}
          {Math.round(element.w)} × {Math.round(element.h)}
          {element.rotation ? ` · ${Math.round(element.rotation)}°` : ""}
          {element.locked ? " · locked" : ""}
        </div>
      ) : null}
    </div>
  );
}
