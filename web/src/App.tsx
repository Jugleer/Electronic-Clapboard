import { useEffect, useRef, useState } from "react";

import { DEFAULT_HOST, persistHost, resolveDefaultHost } from "./config";
import { HEIGHT, WIDTH } from "./frameFormat";
import { useFrameSink } from "./useFrameSink";

// Phase 3 contract: ONE piece of placeholder text drawn by code, no editor
// UI. Phase 4 introduces draggable text boxes etc.
function drawPlaceholder(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "black";
  ctx.font = "bold 96px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("E-CLAPBOARD", WIDTH / 2, HEIGHT / 2 - 40);

  ctx.font = "32px sans-serif";
  ctx.fillText("Phase 3 — canvas → /frame", WIDTH / 2, HEIGHT / 2 + 50);

  ctx.strokeStyle = "black";
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, WIDTH - 40, HEIGHT - 40);
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [host, setHost] = useState<string>(() => resolveDefaultHost());
  const { status, error, lastResult, send } = useFrameSink({ host });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawPlaceholder(ctx);
  }, []);

  const onSend = () => {
    if (!canvasRef.current) return;
    void send(canvasRef.current);
  };

  const onHostBlur = () => {
    persistHost(host);
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, lineHeight: 1.4 }}>
      <h1 style={{ marginTop: 0 }}>Electronic Clapboard — editor</h1>

      <section style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
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
          style={{ fontFamily: "monospace", padding: "4px 8px", minWidth: 240 }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={status === "sending"}
          style={{ padding: "8px 16px", fontSize: 16, fontWeight: 600 }}
        >
          {status === "sending" ? "Sending…" : "Send to clapboard"}
        </button>
        <StatusReadout status={status} error={error} lastResult={lastResult} />
      </section>

      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{
          width: WIDTH,
          height: HEIGHT,
          border: "1px solid #888",
          background: "white",
          imageRendering: "pixelated",
          maxWidth: "100%",
        }}
      />

      <p style={{ color: "#666", marginTop: 12, fontSize: 13 }}>
        Wire format: {WIDTH}×{HEIGHT}, 1bpp MSB-first, 1 = ink. Phase 3 packs
        with a luminance threshold; Phase 6 will introduce Floyd-Steinberg
        dithering. The canvas above is the exact 800×480 frame the firmware
        will receive.
      </p>
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
        ✓ rendered ({lastResult.render_ms} ms,{" "}
        {lastResult.full_refresh ? "full" : "partial"})
      </span>
    );
  }
  if (status === "error" && error) {
    return (
      <span style={{ color: "#a00" }}>
        ✗ {error.code}
        {error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}: {error.message}
      </span>
    );
  }
  return null;
}
