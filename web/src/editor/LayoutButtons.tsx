import { useEffect, useState } from "react";

import { preloadImage } from "./imageCache";
import {
  clearDefaultLayout,
  hasDefaultLayout,
  loadDefaultLayout,
  saveDefaultLayout,
} from "./layoutSlot";
import { useEditorStore } from "./store";

/**
 * Single-slot save/restore for the canvas. The full Phase 7 layout
 * manager (named slots, IndexedDB) replaces this; for now a single
 * "default" slot in localStorage is enough to keep work between
 * sessions.
 */
export function LayoutButtons(): JSX.Element {
  const elements = useEditorStore((s) => s.elements);
  const loadLayout = useEditorStore((s) => s.loadLayout);
  const [present, setPresent] = useState<boolean>(() => hasDefaultLayout());
  const [hint, setHint] = useState<string | null>(null);

  // Refresh the presence indicator if another tab cleared/wrote the slot.
  useEffect(() => {
    const onStorage = () => setPresent(hasDefaultLayout());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const onSave = () => {
    saveDefaultLayout(elements);
    setPresent(true);
    setHint("Saved");
    window.setTimeout(() => setHint(null), 1200);
  };

  const onRestore = () => {
    try {
      const blob = loadDefaultLayout();
      if (!blob) {
        setHint("No saved layout");
        return;
      }
      loadLayout(blob.elements);
      // Pre-warm any image elements so the rasteriser has decoded
      // sources to draw on the next Send.
      for (const el of blob.elements) {
        if (el.type === "image" && el.dataUrl) {
          void preloadImage(el.dataUrl);
        }
      }
      setHint("Restored");
      window.setTimeout(() => setHint(null), 1200);
    } catch (err) {
      setHint(err instanceof Error ? err.message : "load failed");
    }
  };

  const onClear = () => {
    clearDefaultLayout();
    setPresent(false);
    setHint("Cleared");
    window.setTimeout(() => setHint(null), 1200);
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onSave}
        disabled={elements.length === 0}
        style={{ padding: "4px 10px", fontSize: 13 }}
        title="Save the current canvas as the default layout (localStorage)"
      >
        Save default
      </button>
      <button
        type="button"
        onClick={onRestore}
        disabled={!present}
        style={{ padding: "4px 10px", fontSize: 13 }}
        title="Replace the canvas with the saved default layout"
      >
        Restore default
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!present}
        style={{ padding: "4px 10px", fontSize: 13, color: "#a00" }}
        title="Forget the saved default layout"
      >
        Clear
      </button>
      {hint ? (
        <span style={{ color: "#070", fontSize: 12 }}>· {hint}</span>
      ) : null}
    </div>
  );
}
