import Konva from "konva";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_HOST, persistHost, resolveDefaultHost } from "./config";
import { EditorCanvas } from "./editor/EditorCanvas";
import { IconPicker } from "./editor/icons/IconPicker";
import { preloadCategory } from "./editor/icons/loader";
import { LayerPanel } from "./editor/LayerPanel";
import { PropertiesPanel } from "./editor/PropertiesPanel";
import { rasterizeElements } from "./editor/renderToCanvas";
import { useEditorStore } from "./editor/store";
import { addImageFromFile } from "./editor/addImageFromFile";
import { AlignButtons } from "./editor/AlignButtons";
import { GridControls } from "./editor/GridControls";
import { GroupButtons } from "./editor/GroupButtons";
import { HistoryButtons } from "./editor/HistoryButtons";
import { LayoutButtons } from "./editor/LayoutButtons";
import { Toolbar } from "./editor/Toolbar";
import { useKeyboardShortcuts } from "./editor/useKeyboard";
import { useFrameSink } from "./useFrameSink";

export function App() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [host, setHost] = useState<string>(() => resolveDefaultHost());
  const [fullRefresh, setFullRefresh] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const { status, error, lastResult, send } = useFrameSink({ host });
  const elementCount = useEditorStore((s) => s.elements.length);
  // Image elements need a ?full=1 refresh to render properly — partial
  // updates leave grey ghosting on photographic content because the
  // panel's mid-tone equalisation only runs in the full-refresh
  // post-cycle. Force the toggle on (and disable it) whenever any
  // image element is in the layout.
  const hasImage = useEditorStore((s) =>
    s.elements.some((el) => el.type === "image"),
  );
  const effectiveFullRefresh = fullRefresh || hasImage;

  const onPickFile = (mode: "fit" | "background"): React.ChangeEventHandler<HTMLInputElement> =>
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        await addImageFromFile(file, { mode });
        setImageError(null);
      } catch (err) {
        setImageError(err instanceof Error ? err.message : String(err));
      }
    };

  const onCanvasDrop: React.DragEventHandler<HTMLDivElement> = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      await addImageFromFile(file);
      setImageError(null);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : String(err));
    }
  };

  // After a successful ?full=1 response, the firmware still has a
  // deferred partial-content lock-in pass running on its loop() task
  // for ~1.5 s. The /frame endpoint returns 503 during that window if
  // we Send again. Surface this as a transient "post-saturation in
  // progress" hint so the user knows the round-trip isn't fully done.
  // ESTIMATED_LOCKIN_MS errs slightly long; the editor's 503 retry
  // covers any underestimate.
  const ESTIMATED_LOCKIN_MS = 1800;
  const [lockinUntil, setLockinUntil] = useState<number | null>(null);
  useEffect(() => {
    if (status === "done" && lastResult?.full_refresh) {
      setLockinUntil(Date.now() + ESTIMATED_LOCKIN_MS);
    }
  }, [status, lastResult]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (lockinUntil === null) return;
    const remaining = lockinUntil - Date.now();
    if (remaining <= 0) {
      setLockinUntil(null);
      return;
    }
    const id = window.setTimeout(() => setNow(Date.now()), 200);
    return () => window.clearTimeout(id);
  }, [lockinUntil, now]);
  const lockinActive = lockinUntil !== null && now < lockinUntil;

  const onSend = () => {
    const elements = useEditorStore.getState().elements;
    const canvas = rasterizeElements(elements);
    void send(canvas, { full: effectiveFullRefresh });
  };

  useKeyboardShortcuts(editingId === null, onSend);

  // Warm the film-category icon cache on mount so the very first user
  // interaction with the picker is instant. The other categories load
  // lazily as their accordion sections expand.
  useEffect(() => {
    void preloadCategory("film");
  }, []);

  // Persist the host field as the user types (debounced) so a tab
  // close mid-edit doesn't lose a half-typed hostname. The blur
  // handler is left in place for the rare case the user closes the
  // tab inside the debounce window.
  useEffect(() => {
    const id = window.setTimeout(() => persistHost(host), 250);
    return () => window.clearTimeout(id);
  }, [host]);

  const onHostBlur = () => {
    persistHost(host);
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, lineHeight: 1.4 }}>
      <h1 style={{ marginTop: 0 }}>Electronic Clapboard — editor</h1>

      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <label htmlFor="host" style={{ fontWeight: 600 }}>
          Target host:
        </label>
        <input
          id="host"
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onBlur={onHostBlur}
          placeholder={DEFAULT_HOST}
          style={{ fontFamily: "monospace", padding: "4px 8px", minWidth: 220 }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: hasImage ? "#666" : undefined,
          }}
          title={
            hasImage
              ? "Forced on: image elements need a full refresh to render without ghosting"
              : "Forces a clean refresh (?full=1) — ~4 s render, clears ghosting"
          }
        >
          <input
            type="checkbox"
            checked={effectiveFullRefresh}
            disabled={hasImage}
            onChange={(e) => setFullRefresh(e.target.checked)}
          />
          full refresh
          {hasImage ? (
            <span style={{ fontSize: 11, color: "#888" }}>(image present)</span>
          ) : null}
        </label>
        <button
          type="button"
          onClick={onSend}
          disabled={status === "sending" || elementCount === 0}
          style={{ padding: "8px 16px", fontSize: 16, fontWeight: 600 }}
        >
          {status === "sending" ? "Sending…" : "Send to clapboard"}
        </button>
        <StatusReadout status={status} error={error} lastResult={lastResult} />
        {lockinActive ? (
          <span style={{ color: "#a60", fontSize: 13 }}>
            · panel locking in saturation…
          </span>
        ) : null}
      </section>

      <section style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Toolbar />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: "6px 12px", fontSize: 14 }}
              title="Upload a PNG or JPG image (or drop one onto the canvas)"
            >
              + Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPickFile("fit")}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => bgInputRef.current?.click()}
              style={{ padding: "6px 12px", fontSize: 14 }}
              title="Upload a PNG or JPG to fill the canvas as a background layer"
            >
              + Background
            </button>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              onChange={onPickFile("background")}
              style={{ display: "none" }}
            />
            <HistoryButtons />
            <GroupButtons />
          </div>
          <AlignButtons />
          <LayoutButtons />
          <GridControls />
          {imageError ? (
            <div style={{ color: "#a00", fontSize: 12 }}>
              Image upload failed: {imageError}
            </div>
          ) : null}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onCanvasDrop}
            style={{
              position: "relative",
              outline: dragOver ? "3px dashed #0a7" : "none",
              outlineOffset: 2,
            }}
          >
            <EditorCanvas
              stageRef={stageRef}
              containerRef={containerRef}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          </div>
          <p style={{ color: "#666", margin: 0, fontSize: 12, maxWidth: 800 }}>
            800×480 frame, 1bpp MSB-first, 1 = ink. Click a tool to add an
            element; drag to move, drag corners to resize, double-click text
            to edit. Drop a PNG / JPG onto the canvas (or use + Image) to add
            a photo with adjustable threshold. Shift+click and marquee-drag to
            multi-select. Hold Shift while dragging to lock movement to an
            axis. Ctrl+Z / Ctrl+Y undo and redo, Ctrl+D duplicates, Ctrl+A
            selects all, Ctrl+G groups (Ctrl+Shift+G ungroups), Ctrl+Enter
            sends, Delete removes, arrow keys nudge.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
          <PropertiesPanel />
          <LayerPanel />
          <IconPicker />
        </div>
      </section>
    </main>
  );
}

function StatusReadout({
  status,
  error,
  lastResult,
}: {
  status: ReturnType<typeof useFrameSink>["status"];
  error: ReturnType<typeof useFrameSink>["error"];
  lastResult: ReturnType<typeof useFrameSink>["lastResult"];
}) {
  if (status === "idle") return null;
  if (status === "sending") {
    return <span style={{ color: "#444" }}>uploading 48000 bytes…</span>;
  }
  if (status === "done" && lastResult) {
    return (
      <span style={{ color: "#070" }}>
        rendered ({lastResult.render_ms} ms,{" "}
        {lastResult.full_refresh ? "full" : "partial"})
      </span>
    );
  }
  if (status === "error" && error) {
    // From a browser, an asleep device looks identical to "off" or "on a
    // different network" — the TCP connection just refuses or times out.
    // Surface a hint so the user thinks of the wake button before the
    // router. The firmware's deep-sleep arms ext0 wake on PIN_WAKE_BUTTON
    // (see src/power.cpp); a single press wakes the device.
    const looksAsleep = error.code === "network" || error.code === "timeout";
    return (
      <span style={{ color: "#a00" }}>
        {error.code}
        {error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}: {error.message}
        {looksAsleep ? (
          <span style={{ color: "#666", marginLeft: 6 }}>
            · is the device awake? press the wake button
          </span>
        ) : null}
      </span>
    );
  }
  return null;
}
