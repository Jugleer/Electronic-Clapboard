/**
 * Screensaver panel: cycles through the bundled (and user-supplied)
 * images in `web/src/assets/screensaver/` every CYCLE_MS milliseconds,
 * sending each as a full-refresh /frame. Editor-driven (no firmware
 * change) — the panel just runs a setInterval that reuses the same
 * sendFrame path the manual "Send to clapboard" button uses.
 *
 * Intentionally minimal: start/stop, current image label, next-tick
 * countdown, and a thumbnail strip so the user can see what's queued.
 * The 15 s interval is hard-coded for now per the Phase 8 follow-on
 * brief — once we want device-driven cycling (Phase 9 timer-wake),
 * this becomes the staging panel for *that* sequence rather than the
 * cycle's owner.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Palette } from "../editor/themeStore";
import { SCREENSAVER_IMAGES, type ScreensaverImage } from "./images";
import { sendScreensaverImage } from "./sendImage";

export const CYCLE_MS = 15_000;

interface Props {
  host: string;
  palette: Palette;
  /** Notified when a cycle send finishes (for the global StatusReadout). */
  onSent?: (label: string, ok: boolean, err?: string) => void;
}

export function ScreensaverPanel({ host, palette, onSent }: Props) {
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [tickAt, setTickAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  // Hold the latest setter callbacks in a ref so the interval doesn't
  // need to be torn down/recreated when index changes mid-cycle.
  const stateRef = useRef({ index });
  stateRef.current = { index };

  const sendOne = useCallback(
    async (img: ScreensaverImage) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await sendScreensaverImage(img.url, host);
        onSent?.(
          img.label,
          result.ok,
          result.ok ? undefined : `${result.code}: ${result.error}`,
        );
      } catch (e) {
        onSent?.(img.label, false, e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
      }
    },
    [host, onSent],
  );

  // Drive the cycle. One interval, fires immediately on start so the
  // user gets visual feedback within ~5 s rather than waiting 15.
  useEffect(() => {
    if (!running || SCREENSAVER_IMAGES.length === 0) {
      setTickAt(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const i = stateRef.current.index;
      const img = SCREENSAVER_IMAGES[i];
      void sendOne(img);
      setIndex((prev) => (prev + 1) % SCREENSAVER_IMAGES.length);
      setTickAt(Date.now() + CYCLE_MS);
    };
    tick(); // first frame immediately
    const id = window.setInterval(tick, CYCLE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [running, sendOne]);

  // Lightweight 1 Hz tick to update the countdown readout.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (SCREENSAVER_IMAGES.length === 0) {
    return (
      <section style={panelStyle(palette)}>
        <header style={headerStyle(palette)}>Screensaver</header>
        <p style={{ margin: 0, fontSize: 12, color: palette.textMuted }}>
          No images found. Drop PNG/JPG/SVG files into{" "}
          <code>web/src/assets/screensaver/</code> and restart the dev server.
        </p>
      </section>
    );
  }

  const remainingSec =
    tickAt !== null ? Math.max(0, Math.ceil((tickAt - now) / 1000)) : null;
  const currentLabel =
    SCREENSAVER_IMAGES[
      (index - 1 + SCREENSAVER_IMAGES.length) % SCREENSAVER_IMAGES.length
    ]?.label ?? "—";

  return (
    <section style={panelStyle(palette)}>
      <header style={headerStyle(palette)}>
        Screensaver
        <span
          style={{
            fontWeight: 400,
            fontSize: 12,
            color: palette.textMuted,
            marginLeft: 8,
          }}
        >
          cycles {SCREENSAVER_IMAGES.length} image
          {SCREENSAVER_IMAGES.length === 1 ? "" : "s"} every{" "}
          {Math.round(CYCLE_MS / 1000)} s
        </span>
      </header>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          style={{
            padding: "6px 12px",
            fontSize: 14,
            fontWeight: 600,
            background: running ? palette.buttonBgActive : palette.buttonBg,
            color: palette.text,
            border: `1px solid ${palette.buttonBorder}`,
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          {running ? "■ stop" : "▶ start"}
        </button>
        <span style={{ fontSize: 13, color: palette.text }}>
          {running
            ? `now: ${currentLabel}${
                remainingSec !== null ? ` · next in ${remainingSec} s` : ""
              }`
            : "idle"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        {SCREENSAVER_IMAGES.map((img, i) => {
          const isCurrent =
            running &&
            i ===
              (index - 1 + SCREENSAVER_IMAGES.length) %
                SCREENSAVER_IMAGES.length;
          return (
            <div
              key={img.id}
              title={img.label}
              style={{
                width: 80,
                height: 48,
                border: `2px solid ${
                  isCurrent ? palette.link : palette.panelBorder
                }`,
                background: "#fff",
                borderRadius: 2,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={img.url}
                alt={img.label}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  display: "block",
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function panelStyle(palette: Palette): React.CSSProperties {
  return {
    border: `1px solid ${palette.panelBorder}`,
    background: palette.panelBg,
    padding: 10,
    borderRadius: 4,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };
}

function headerStyle(palette: Palette): React.CSSProperties {
  return {
    fontWeight: 600,
    fontSize: 14,
    color: palette.textHeading,
    display: "flex",
    alignItems: "center",
  };
}
