import { FRAME_BYTES, HEIGHT, WIDTH } from "./frameFormat";

export function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, lineHeight: 1.5 }}>
      <h1>Electronic Clapboard — editor</h1>
      <p>
        Phase 0 skeleton. The canvas, send button, and editor UI land in
        Phase 3+. This page exists so <code>vite build</code> has something
        to compile.
      </p>
      <p>
        Wire format: {WIDTH}×{HEIGHT}, {FRAME_BYTES} bytes, 1bpp MSB-first,
        1 = ink. See <code>docs/protocol.md</code>.
      </p>
    </main>
  );
}
