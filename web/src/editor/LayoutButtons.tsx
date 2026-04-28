import { useEffect, useRef, useState } from "react";

import { HEIGHT, WIDTH } from "../frameFormat";
import { preloadImage } from "./imageCache";
import { migrateLegacyLayouts } from "./layoutMigrate";
import {
  deleteLayout,
  exportLayoutJson,
  importLayoutJson,
  LayoutQuotaError,
  LayoutSchemaError,
  listLayouts,
  loadLayout,
  renameLayout,
  saveLayout,
  type LayoutSummary,
} from "./layoutStore";
import { rasterizeElements } from "./renderToCanvas";
import { useEditorStore } from "./store";
import { paletteFor, useThemeStore, type Palette } from "./themeStore";

const THUMB_W = 200;
const THUMB_H = Math.round((THUMB_W * HEIGHT) / WIDTH); // 120

// Show the search filter once the list grows past this many rows;
// at low N it's just visual noise.
const SEARCH_VISIBLE_MIN = 6;

/**
 * Unbounded named layouts in IndexedDB. Each row offers
 * Load / Export / Delete plus an editable name; hovering a row
 * surfaces the thumbnail captured when the layout was saved.
 *
 * On first mount, runs the v2 localStorage → v3 IDB migrator
 * (idempotent — a no-op once the legacy keys are gone) so existing
 * users transparently land on the new backend.
 */
export function LayoutButtons(): JSX.Element {
  const elements = useEditorStore((s) => s.elements);
  const replaceLayout = useEditorStore((s) => s.loadLayout);

  const [list, setList] = useState<LayoutSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [hint, setHint] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    try {
      setList(await listLayouts());
    } catch (err) {
      setHint(err instanceof Error ? err.message : "failed to read layouts");
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await migrateLegacyLayouts();
      } catch {
        // Migration failure shouldn't block the picker; the user can
        // still save fresh layouts on top.
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showHint = (msg: string) => {
    setHint(msg);
    window.setTimeout(() => {
      setHint((current) => (current === msg ? null : current));
    }, 2000);
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

  const onSaveNew = async () => {
    if (elements.length === 0) {
      showHint("Canvas is empty");
      return;
    }
    const name =
      window.prompt("Name this layout:", `Layout ${list.length + 1}`) ?? "";
    if (!name.trim()) return;
    try {
      const saved = await saveLayout({
        name,
        elements,
        thumbnail: captureThumbnail(),
      });
      await refresh();
      showHint(`Saved ${saved.name}`);
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const onOverwrite = async (id: string, name: string) => {
    if (elements.length === 0) {
      showHint("Canvas is empty");
      return;
    }
    if (!window.confirm(`Overwrite "${name}" with the current canvas?`)) return;
    try {
      await saveLayout({
        id,
        name,
        elements,
        thumbnail: captureThumbnail(),
      });
      await refresh();
      showHint(`Saved over ${name}`);
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const onLoad = async (id: string) => {
    try {
      const record = await loadLayout(id);
      if (!record) {
        showHint("Layout not found");
        return;
      }
      replaceLayout(record.elements);
      for (const el of record.elements) {
        if (el.type === "image" && el.dataUrl) {
          void preloadImage(el.dataUrl);
        }
      }
      showHint(`Restored ${record.name}`);
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" permanently? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteLayout(id);
      await refresh();
      showHint(`Deleted ${name}`);
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const onExport = async (id: string) => {
    try {
      const out = await exportLayoutJson(id);
      if (!out) {
        showHint("Layout not found");
        return;
      }
      downloadJson(out.filename, out.json);
      showHint(`Exported ${out.filename}`);
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const onImportClick = () => {
    importInputRef.current?.click();
  };

  const onImportFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const record = await importLayoutJson(text);
      await refresh();
      showHint(`Imported ${record.name}`);
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const beginRename = (id: string, currentName: string) => {
    setEditingId(id);
    setDraftName(currentName);
  };

  const commitRename = async () => {
    if (editingId === null) return;
    const id = editingId;
    const name = draftName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      await renameLayout(id, name);
      await refresh();
    } catch (err) {
      showHint(formatError(err));
    }
  };

  const cancelRename = () => setEditingId(null);

  const palette = paletteFor(useThemeStore((s) => s.mode));
  const filtered = filterList(list, search);
  const showSearch = list.length >= SEARCH_VISIBLE_MIN;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        border: `1px solid ${palette.panelBorder}`,
        background: palette.panelBg,
        color: palette.text,
        padding: 6,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 2,
        }}
      >
        <span style={{ fontWeight: 600, color: palette.textHeading }}>
          Layouts
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={onSaveNew}
            disabled={elements.length === 0}
            title="Save current canvas as a new layout"
            style={{ padding: "2px 8px", fontSize: 12 }}
          >
            + new
          </button>
          <button
            type="button"
            onClick={onImportClick}
            title="Import a layout from a JSON file"
            style={{ padding: "2px 8px", fontSize: 12 }}
          >
            import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {showSearch ? (
        <input
          type="text"
          placeholder="filter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            fontSize: 12,
            padding: "2px 4px",
            background: palette.inputBg,
            color: palette.text,
            border: `1px solid ${palette.inputBorder}`,
          }}
        />
      ) : null}

      <div
        style={{
          maxHeight: 280,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              color: palette.textMuted,
              fontStyle: "italic",
              padding: "4px 6px",
              fontSize: 12,
            }}
          >
            {list.length === 0
              ? "No saved layouts yet. Click + new to save the current canvas."
              : `No layout matches "${search}".`}
          </div>
        ) : (
          filtered.map((entry) => (
            <LayoutRow
              key={entry.id}
              entry={entry}
              editing={editingId === entry.id}
              draftName={draftName}
              setDraftName={setDraftName}
              onBeginRename={() => beginRename(entry.id, entry.name)}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onLoad={() => onLoad(entry.id)}
              onOverwrite={() => onOverwrite(entry.id, entry.name)}
              onExport={() => onExport(entry.id)}
              onDelete={() => onDelete(entry.id, entry.name)}
              canOverwrite={elements.length > 0}
              palette={palette}
            />
          ))
        )}
      </div>

      {hint ? (
        <span style={{ color: palette.statusOk, fontSize: 12 }}>· {hint}</span>
      ) : null}
    </div>
  );
}

function filterList(list: LayoutSummary[], search: string): LayoutSummary[] {
  const q = search.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => e.name.toLowerCase().includes(q));
}

function formatError(err: unknown): string {
  if (err instanceof LayoutQuotaError) return err.message;
  if (err instanceof LayoutSchemaError) return err.message;
  if (err instanceof Error) return err.message;
  return "operation failed";
}

function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface LayoutRowProps {
  entry: LayoutSummary;
  editing: boolean;
  draftName: string;
  setDraftName: (s: string) => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onLoad: () => void;
  onOverwrite: () => void;
  onExport: () => void;
  onDelete: () => void;
  canOverwrite: boolean;
  palette: Palette;
}

function LayoutRow({
  entry,
  editing,
  draftName,
  setDraftName,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onLoad,
  onOverwrite,
  onExport,
  onDelete,
  canOverwrite,
  palette,
}: LayoutRowProps): JSX.Element {
  const [showPreview, setShowPreview] = useState(false);
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
        onClick={() => !editing && onBeginRename()}
        style={{
          flex: 1,
          minWidth: 90,
          maxWidth: 160,
          padding: "2px 6px",
          color: palette.text,
          cursor: editing ? "default" : "text",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title="Click to rename — hover for preview"
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
          entry.name
        )}
        {showPreview && entry.thumbnail ? (
          <img
            src={entry.thumbnail}
            alt={`${entry.name} preview`}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 100,
              width: THUMB_W,
              height: THUMB_H,
              border: `1px solid ${palette.panelBorder}`,
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
        onClick={onLoad}
        title={`Restore ${entry.name}`}
        style={{ padding: "2px 6px", fontSize: 12 }}
      >
        load
      </button>
      <button
        type="button"
        onClick={onOverwrite}
        disabled={!canOverwrite}
        title={`Overwrite ${entry.name} with current canvas`}
        style={{ padding: "2px 6px", fontSize: 12 }}
      >
        save
      </button>
      <button
        type="button"
        onClick={onExport}
        title={`Export ${entry.name} as JSON`}
        style={{ padding: "2px 6px", fontSize: 12 }}
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onDelete}
        title={`Delete ${entry.name}`}
        style={{ padding: "2px 6px", fontSize: 12, color: palette.statusError }}
      >
        ×
      </button>
    </div>
  );
}
