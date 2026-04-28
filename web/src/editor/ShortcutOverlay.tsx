/**
 * `?` keyboard-shortcut help overlay. Modal-style: dimmed backdrop,
 * centred panel, Esc / click-outside dismisses. Reads the same
 * `SHORTCUTS` table the handler uses so the list never drifts from
 * the actual behaviour.
 */

import { useEffect } from "react";

import { Panel } from "./ui";
import { fs, space } from "./ui-tokens";
import { SHORTCUTS, type ShortcutCategory } from "./useKeyboard";
import { usePalette } from "./themeStore";

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  send: "Send",
  edit: "Edit",
  selection: "Selection",
  layout: "Layout",
  view: "View",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutOverlay({ open, onClose }: Props): JSX.Element | null {
  const palette = usePalette();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Group shortcuts by category, preserving table order.
  const grouped = new Map<ShortcutCategory, typeof SHORTCUTS[number][]>();
  for (const s of SHORTCUTS) {
    const list = grouped.get(s.category) ?? [];
    list.push(s);
    grouped.set(s.category, list);
  }
  const categories: ShortcutCategory[] = ["send", "edit", "selection", "layout", "view"];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: space.lg,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: "100%" }}>
        <Panel
          title="Keyboard shortcuts"
          actions={
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "transparent",
                color: palette.textMuted,
                border: "none",
                fontSize: fs.h2,
                lineHeight: 1,
                cursor: "pointer",
                padding: `0 ${space.xs}px`,
              }}
            >
              ×
            </button>
          }
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: space.lg,
            }}
          >
            {categories.map((cat) => {
              const items = grouped.get(cat);
              if (!items || items.length === 0) return null;
              return (
                <section key={cat}>
                  <h3
                    style={{
                      margin: 0,
                      marginBottom: space.xs,
                      fontSize: fs.body,
                      fontWeight: 600,
                      color: palette.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {items.map((s) => (
                        <tr key={s.keys}>
                          <td
                            style={{
                              padding: "3px 0",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: fs.caption,
                              color: palette.text,
                              whiteSpace: "nowrap",
                              verticalAlign: "top",
                              paddingRight: space.sm,
                            }}
                          >
                            {s.keys}
                          </td>
                          <td
                            style={{
                              padding: "3px 0",
                              fontSize: fs.caption,
                              color: palette.textMuted,
                            }}
                          >
                            {s.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
          <div
            style={{
              marginTop: space.md,
              fontSize: fs.caption,
              color: palette.textMuted,
            }}
          >
            Press <kbd>Esc</kbd> or click outside to close. Cmd works
            wherever Ctrl is shown (macOS).
          </div>
        </Panel>
      </div>
    </div>
  );
}
