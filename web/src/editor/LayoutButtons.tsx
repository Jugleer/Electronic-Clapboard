import { useEffect, useState } from "react";

import { HEIGHT, WIDTH } from "../frameFormat";
import { preloadImage } from "./imageCache";
import {
  clearSlot,
  LayoutQuotaError,
  listSlots,
  loadSlot,
  renameSlot,
  saveSlot,
  type LayoutSlot,
} from "./layoutSlot";
import { rasterizeElements } from "./renderToCanvas";
import { useEditorStore } from "./store";

const THUMB_W = 200;
const THUMB_H = Math.round((THUMB_W * HEIGHT) / WIDTH); // 120

/**
 * Three named layout slots in localStorage. Each row offers
 * Save / Restore / Clear plus an editable name. Hovering a row's
 * name surfaces the thumbnail captured when the slot was saved.
 */
export function LayoutButtons(): JSX.Element {
  const elements = useEditorStore((s) => s.elements);
  const loadLayout = useEditorStore((s) => s.loadLayout);
  const [slots, setSlots] = useState<(LayoutSlot | null)[]>(() => listSlots());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [hint, setHint] = useState<string | null>(null);

  // Other tabs may save/clear slots while we're open. The `storage`
  // event keeps the picker in sync without a poll.
  useEffect(() => {
    const onStorage = () => setSlots(listSlots());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const showHint = (msg: string) => {
    setHint(msg);
    window.setTimeout(() => setHint(null), 1500);
  };

  const captureThumbnail = (): string | null => {
    try {
      const full = rasterizeElements(elements);
      const t = document.createElement("canvas");
      t.width = THUMB_W;
      t.height = THUMB_H;
      const ctx = t.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, THUMB_W, THUMB_H);
      ctx.drawImage(full, 0, 0, THUMB_W, THUMB_H);
      return t.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const onSave = (index: number) => {
    const existing = slots[index];
    const name = existing?.name ?? `Slot ${index + 1}`;
    const thumb = captureThumbnail();
    try {
      saveSlot(index, name, elements, thumb);
      setSlots(listSlots());
      showHint(`Saved to ${name}`);
    } catch (err) {
      showHint(
        err instanceof LayoutQuotaError
          ? err.message
          : err instanceof Error
            ? err.message
            : "save failed",
      );
    }
  };

  const onRestore = (index: number) => {
    const slot = loadSlot(index);
    if (!slot) {
      showHint("Slot is empty");
      return;
    }
    loadLayout(slot.elements);
    for (const el of slot.elements) {
      if (el.type === "image" && el.dataUrl) {
        void preloadImage(el.dataUrl);
      }
    }
    showHint(`Restored ${slot.name}`);
  };

  const onClear = (index: number) => {
    clearSlot(index);
    setSlots(listSlots());
    showHint("Cleared");
  };

  const beginRename = (index: number) => {
    if (!slots[index]) return;
    setEditingIndex(index);
    setDraftName(slots[index]?.name ?? "");
  };

  const commitRename = () => {
    if (editingIndex === null) return;
    renameSlot(editingIndex, draftName);
    setSlots(listSlots());
    setEditingIndex(null);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        border: "1px solid #ccc",
        background: "#fafafa",
        padding: 6,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>Layouts</div>
      {slots.map((slot, i) => (
        <SlotRow
          key={i}
          index={i}
          slot={slot}
          editing={editingIndex === i}
          draftName={draftName}
          setDraftName={setDraftName}
          onBeginRename={() => beginRename(i)}
          onCommitRename={commitRename}
          onCancelRename={() => setEditingIndex(null)}
          onSave={() => onSave(i)}
          onRestore={() => onRestore(i)}
          onClear={() => onClear(i)}
          canSave={elements.length > 0}
        />
      ))}
      {hint ? (
        <span style={{ color: "#070", fontSize: 12 }}>· {hint}</span>
      ) : null}
    </div>
  );
}

interface SlotRowProps {
  index: number;
  slot: LayoutSlot | null;
  editing: boolean;
  draftName: string;
  setDraftName: (s: string) => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSave: () => void;
  onRestore: () => void;
  onClear: () => void;
  canSave: boolean;
}

function SlotRow({
  index,
  slot,
  editing,
  draftName,
  setDraftName,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onSave,
  onRestore,
  onClear,
  canSave,
}: SlotRowProps): JSX.Element {
  const [showPreview, setShowPreview] = useState(false);
  const occupied = slot !== null;
  const label = slot?.name ?? `Slot ${index + 1}`;
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "center",
        position: "relative",
      }}
    >
      <div
        onMouseEnter={() => setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
        onClick={() => occupied && !editing && onBeginRename()}
        style={{
          flex: 1,
          minWidth: 90,
          maxWidth: 140,
          padding: "2px 6px",
          color: occupied ? "#000" : "#888",
          fontStyle: occupied ? "normal" : "italic",
          cursor: occupied && !editing ? "text" : "default",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={occupied ? "Click to rename — hover for preview" : ""}
      >
        {editing ? (
          <input
            type="text"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            style={{ width: "100%", fontSize: 12, padding: "1px 4px" }}
          />
        ) : (
          label
        )}
        {showPreview && occupied && slot.thumbnail ? (
          <img
            src={slot.thumbnail}
            alt={`${label} preview`}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 100,
              width: THUMB_W,
              height: THUMB_H,
              border: "1px solid #888",
              background: "white",
              boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
              pointerEvents: "none",
              marginTop: 4,
            }}
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        title={`Save current canvas to ${label}`}
        style={{ padding: "2px 6px", fontSize: 12 }}
      >
        save
      </button>
      <button
        type="button"
        onClick={onRestore}
        disabled={!occupied}
        title={`Restore ${label}`}
        style={{ padding: "2px 6px", fontSize: 12 }}
      >
        load
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!occupied}
        title={`Clear ${label}`}
        style={{ padding: "2px 6px", fontSize: 12, color: "#a00" }}
      >
        ×
      </button>
    </div>
  );
}
