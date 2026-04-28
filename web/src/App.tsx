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
import { ShortcutOverlay } from "./editor/ShortcutOverlay";
import { useFrameSink } from "./useFrameSink";
import { useDeviceStatus, type DeviceStatusInfo } from "./useDeviceStatus";
import { ScreensaverPanel } from "./screensaver/Screensaver";
import { useThemeStore, usePalette, type Palette } from "./editor/themeStore";
import { Button, HStack, Input } from "./editor/ui";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const { status, error, lastResult, send } = useFrameSink({ host });
  const deviceStatus = useDeviceStatus({ host });
  const elementCount = useEditorStore((s) => s.elements.length);
  const palette = usePalette();
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  // Paint the html/body background so the dark mode covers the whole
  // viewport, not just the <main>. Inline styles don't reach <body>.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.background = palette.bg;
    body.style.background = palette.bg;
    body.style.color = palette.text;
    body.dataset.theme = themeMode;
  }, [palette, themeMode]);
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

  useKeyboardShortcuts(editingId === null && !helpOpen, onSend, {
    onShowHelp: () => setHelpOpen(true),
    onClipboardError: (msg) => {
      setClipboardHint(msg);
      window.setTimeout(
        () => setClipboardHint((current) => (current === msg ? null : current)),
        2500,
      );
    },
  });

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
    <main
      style={{
        fontFamily: "system-ui",
        padding: 16,
        lineHeight: 1.4,
        color: palette.text,
        background: palette.bg,
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          marginTop: 0,
          marginBottom: 16,
          color: palette.textHeading,
          fontSize: 22,
          letterSpacing: -0.2,
        }}
      >
        Electronic Clapboard
        <span style={{ color: palette.textMuted, fontWeight: 400 }}> — editor</span>
      </h1>

      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        {/* Left cluster: device connection. */}
        <HStack gap="sm" wrap>
          <label
            htmlFor="host"
            style={{ fontWeight: 500, fontSize: 13, color: palette.textMuted }}
          >
            Host
          </label>
          <Input
            id="host"
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onBlur={onHostBlur}
            placeholder={DEFAULT_HOST}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minWidth: 220 }}
          />
          <DeviceStatusBadge info={deviceStatus} palette={palette} />
        </HStack>

        {/* Right cluster: send action + view controls. */}
        <HStack gap="sm" wrap>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              color: hasImage ? palette.textMuted : palette.text,
              userSelect: "none",
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
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                (image)
              </span>
            ) : null}
          </label>
          <Button
            variant="primary"
            size="lg"
            onClick={onSend}
            disabled={status === "sending" || elementCount === 0}
          >
            {status === "sending" ? "Sending…" : "Send to clapboard"}
          </Button>
          <Button
            size="sm"
            onClick={toggleTheme}
            title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {themeMode === "dark" ? "☀ light" : "☾ dark"}
          </Button>
        </HStack>
      </section>

      {/* Status row: kept on its own line so it doesn't push the
          send button around when long error messages appear. */}
      {status !== "idle" || lockinActive ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <StatusReadout
            status={status}
            error={error}
            lastResult={lastResult}
            palette={palette}
          />
          {lockinActive ? (
            <span style={{ color: palette.statusWarn }}>
              · panel locking in saturation…
            </span>
          ) : null}
        </div>
      ) : null}

      <section style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Toolbar />
            <Button
              onClick={() => fileInputRef.current?.click()}
              title="Upload a PNG or JPG image (or drop one onto the canvas)"
            >
              + Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPickFile("fit")}
              style={{ display: "none" }}
            />
            <Button
              onClick={() => bgInputRef.current?.click()}
              title="Upload a PNG or JPG to fill the canvas as a background layer"
            >
              + Background
            </Button>
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
          <ScreensaverPanel host={host} palette={palette} />
          {imageError ? (
            <div style={{ color: palette.statusError, fontSize: 12 }}>
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
              outline: dragOver ? `3px dashed ${palette.link}` : "none",
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
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 12,
              color: palette.textMuted,
            }}
          >
            <span>800×480 frame, 1bpp MSB-first, 1 = ink.</span>
            <Button
              size="sm"
              onClick={() => setHelpOpen(true)}
              title="Show keyboard shortcuts (?)"
            >
              ? shortcuts
            </Button>
            {clipboardHint ? (
              <span style={{ color: palette.statusWarn }}>
                · {clipboardHint}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
          <PropertiesPanel />
          <LayerPanel />
          <IconPicker />
        </div>
      </section>
      <ShortcutOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}

function StatusReadout({
  status,
  error,
  lastResult,
  palette,
}: {
  status: ReturnType<typeof useFrameSink>["status"];
  error: ReturnType<typeof useFrameSink>["error"];
  lastResult: ReturnType<typeof useFrameSink>["lastResult"];
  palette: Palette;
}) {
  if (status === "idle") return null;
  if (status === "sending") {
    return <span style={{ color: palette.text }}>uploading 48000 bytes…</span>;
  }
  if (status === "done" && lastResult) {
    return (
      <span style={{ color: palette.statusOk }}>
        rendered ({lastResult.render_ms} ms,{" "}
        {lastResult.full_refresh ? "full" : "partial"})
      </span>
    );
  }
  if (status === "error" && error) {
    // The persistent DeviceStatusBadge already covers the asleep
    // hint, so suppress the inline one here to avoid duplication.
    return (
      <span style={{ color: palette.statusError }}>
        {error.code}
        {error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}: {error.message}
      </span>
    );
  }
  return null;
}

// Phase 9: minimum firmware version that emits fire telemetry. Older
// firmwares omit the keys entirely and leave parseStatusBody fields
// undefined; in that case we hide the fire badge to keep the chrome
// honest (no "fire ready" claim about a firmware that has no fire path).
const FIRE_FIELDS_MIN_VERSION = "0.4.0";

function compareSemver(a: string, b: string): number {
  // Returns negative / zero / positive like strcmp on the (major,
  // minor, patch) tuple. Pre-release suffixes are ignored — they don't
  // appear in our firmware version strings (we ship "0.X.Y" plain).
  const pa = a.split(".").map((p) => parseInt(p, 10));
  const pb = b.split(".").map((p) => parseInt(p, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function fireFieldsSupported(firmwareVersion?: string): boolean {
  if (!firmwareVersion) return false;
  return compareSemver(firmwareVersion, FIRE_FIELDS_MIN_VERSION) >= 0;
}

function DeviceStatusBadge({
  info,
  palette,
}: {
  info: DeviceStatusInfo;
  palette: Palette;
}) {
  // Collapse the four states into three pieces of presentation:
  //   awake   → green "Awake" pill, last-seen timestamp on hover
  //   asleep  → muted "Asleep" pill + inline wake-button hint
  //   unknown → neutral "…" pill while the first poll is in flight
  //   error   → orange "Server error" pill (rare; the device is up
  //             but /status replied 4xx/5xx — almost certainly a bug
  //             we want visible)
  const map: Record<
    DeviceStatusInfo["state"],
    { label: string; color: string; bg: string; border: string; hint?: string }
  > = {
    awake: {
      label: "● Awake",
      color: palette.statusOk,
      bg: "transparent",
      border: palette.statusOk,
    },
    asleep: {
      label: "○ Asleep",
      color: palette.textMuted,
      bg: "transparent",
      border: palette.panelBorder,
      hint: "press the wake button on the device",
    },
    unknown: {
      label: "… checking",
      color: palette.textMuted,
      bg: "transparent",
      border: palette.panelBorder,
    },
    error: {
      label: "! status error",
      color: palette.statusWarn,
      bg: "transparent",
      border: palette.statusWarn,
      hint: info.detail,
    },
  };
  const m = map[info.state];
  const lastSeenAgo =
    info.lastSeen !== null
      ? `last seen ${Math.max(0, Math.round((Date.now() - info.lastSeen) / 1000))} s ago`
      : "never reached";
  // Hint, last-seen timestamp, and any error detail all collapse into a
  // single native tooltip on hover — keeps the chrome quiet while the
  // device is asleep but still surfaces the wake hint when the user
  // wonders why /frame would fail.
  const tooltipParts: string[] = [];
  if (m.hint) tooltipParts.push(m.hint);
  if (info.state === "awake") tooltipParts.push("device responded to /status");
  else tooltipParts.push(lastSeenAgo);
  if (info.detail && info.state !== "asleep") tooltipParts.push(info.detail);
  const tooltip = tooltipParts.join(" · ");
  return (
    <>
      <span
        title={tooltip}
        style={{
          padding: "2px 8px",
          fontSize: 12,
          fontWeight: 600,
          color: m.color,
          background: m.bg,
          border: `1px solid ${m.border}`,
          borderRadius: 999,
          fontFamily: "monospace",
          letterSpacing: 0.2,
          cursor: "help",
        }}
      >
        {m.label}
      </span>
      {info.state === "awake" && fireFieldsSupported(info.firmwareVersion) && (
        <FireReadyBadge info={info} palette={palette} />
      )}
    </>
  );
}

// Phase 9: separate pill that surfaces fire telemetry when the device
// is awake AND the firmware emits the new fields. Two states only:
//
//   ready   — green dot, "fire ready"
//   blocked — orange, "fire blocked"
//
// We deliberately don't try to render "cooling down" as a third state.
// Cooldown is 1500 ms; the /status poll cadence is 8000 ms — by the
// time the next poll runs the cooldown will almost always have ended,
// so a "cooling" badge would flicker into existence for one frame and
// out again, rarely catching a real cooldown. fire_ready=false in the
// wild is overwhelmingly "low battery". The tooltip mentions both
// possibilities so a fast-polling devtools user understands why.
function FireReadyBadge({
  info,
  palette,
}: {
  info: DeviceStatusInfo;
  palette: Palette;
}) {
  const ready = info.fireReady === true;
  const lastFire = info.lastFireAtMs ?? null;
  const fires = info.firesSinceBoot ?? 0;
  const label = ready ? "● fire ready" : "! fire blocked";
  const color = ready ? palette.statusOk : palette.statusWarn;
  const border = ready ? palette.statusOk : palette.statusWarn;
  const tooltipParts: string[] = [];
  if (ready) {
    tooltipParts.push("fire button is armed");
  } else {
    tooltipParts.push("low battery, or still in cooldown");
  }
  tooltipParts.push(`${fires} fire${fires === 1 ? "" : "s"} this session`);
  if (lastFire !== null) {
    tooltipParts.push(`last fire at ${lastFire} ms uptime`);
  }
  return (
    <span
      title={tooltipParts.join(" · ")}
      style={{
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 600,
        color,
        background: "transparent",
        border: `1px solid ${border}`,
        borderRadius: 999,
        fontFamily: "monospace",
        letterSpacing: 0.2,
        cursor: "help",
        marginLeft: 6,
      }}
    >
      {label}
    </span>
  );
}
