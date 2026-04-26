# Wireless Frame-Streaming Editor — Phased Build Plan

A staged plan to evolve the clapboard from a USB-tethered demo into a Wi-Fi-connected device driven by a browser-based label editor (P-Touch-style). Each phase is sized to fit comfortably in a single max-effort Claude Opus 4.7 conversation: scope, implement, test, hand-off.

## Architecture in one diagram

```
┌─────────────────────────────────────┐         ┌──────────────────────┐
│  Browser (the editor)               │         │  ESP32-S3            │
│  - canvas with draggable elements   │         │  - Wi-Fi station     │
│  - text/font/icon/image tools       │         │  - HTTP server       │
│  - "Send" → rasterise → POST /frame │  HTTP   │  - on POST /frame:   │
│                                     │ ◄─────► │    decode, push EPD  │
│  Static files served from...        │         │  - on POST /sync:    │
└─────────────────────────────────────┘         │    fire LED+solenoid │
            ▲                                   └──────────────────────┘
            │ served by
┌─────────────────────────────────────┐
│  Local dev server (your laptop)     │
│  - Vite serving the editor          │
│  - browser hits ESP32 directly      │
└─────────────────────────────────────┘
```

The ESP32 is a dumb frame sink. The browser does all the rendering. The Vite dev server only serves the editor app — the ESP32 doesn't host the editor itself.

## v1 scope summary

**In:** Wi-Fi (STA mode, mDNS as `clapboard.local`), HTTP `/frame` + `/sync` + `/status` endpoints, browser editor with text boxes / shape primitives / icon library / image upload + dithering, save/load layouts in browser storage. Wi-Fi creds via gitignored `secrets.h`.

**Out (deferred to v2+):** AP-mode captive portal, NVS-backed Wi-Fi creds, mobile UI, undo/redo, freehand drawing, multi-page templates, live preview while typing, diff frames.

---

## Phase 0 — Foundations and contract freeze

**Slice delivered:** No runtime behaviour change. Repo restructured to host firmware + frontend, the wire protocol is written down, CI is in place, `secrets.h.example` exists. The typewriter demo from Phase 3 of the original build still runs.

### What lands
- New top-level dirs: `web/` (Vite project skeleton, not yet wired up), `docs/protocol.md` (HTTP contract: endpoints, content types, status codes, error shapes, frame byte layout)
- `tools/frame_format.py` — shared spec module for the wire format. Both Python tests and the frontend test suite reference it (mirror or import).
- `include/secrets.h.example` checked in; `include/secrets.h` remains gitignored.
- `platformio.ini` keeps the existing `[env:esp32s3]` for the typewriter demo. Phase 1 introduces a parallel build target so we never break what works.
- GitHub Actions workflow with three stages: `pio test -e native` (passes on a sentinel test), `pio run -e esp32s3` (build only), and `cd web && npm run build && npm test && npm run typecheck` on the empty skeleton.
- README updated with the new build matrix.

### Acceptance tests
- `pio run -e esp32s3` still builds the typewriter demo.
- `pio test -e native` runs and passes (even if only a sentinel test).
- `cd web && npm run build && npm test && npm run typecheck` all succeed on the skeleton.
- CI passes on a PR with this phase only.
- `docs/protocol.md` reviewed and signed off — this is the artifact later phases must not silently violate.

### Decisions to lock in this phase (cross-cutting concerns)
1. **Wire byte sense:** `1 = ink (black)`, MSB-first, scanlines top-to-bottom. Matches existing `tools/generate_slides.py:encode_1bpp_msb`. Lock in `protocol.md`.
2. **Frame size:** 800×480 = 48,000 bytes. Document.
3. **Coordinate convention:** origin top-left, x grows right, y grows down. Matches canvas and panel.
4. **Frontend stack:** React + Vite + TypeScript + Vitest. Pin specific versions; don't drift.
5. **State management library:** decide now. Default suggestion: Zustand (lightweight, less boilerplate than Redux Toolkit, more capable than `useReducer` for editor state).
6. **Editor library:** decide between `react-konva` / `tldraw` / `fabric.js` / hand-rolled. **Spike first:** spend 30 minutes prototyping a draggable + resizable text box in each top candidate before committing.
7. **HTTP server library on ESP32:** `ESPAsyncWebServer` (better fit for 48 KB POSTs) or built-in `WebServer.h`. Decide in Phase 1, but flag the choice now.
8. **CORS policy:** wide-open in dev (`Access-Control-Allow-Origin: *`). Document that we'll tighten in v2.
9. **Conventional commit prefixes:** existing `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `hw:` from CLAUDE.md, plus new `web:` for frontend changes.

### Risks
- **Scope creep into "let's also reorganise `src/` into modules now."** Don't. Keep `main.cpp` untouched. Module split belongs in Phase 4 of the firmware refactor (i.e. when there's a real reason).
- **Underspecified protocol.** The doc must include error responses and timeouts, not just happy paths. Underspecified contracts cost more later than they save now.
- **CI for embedded builds is fiddly** (PlatformIO cache, toolchain download). Budget time; don't let it derail the phase.

### Hand-off
Two buildable trees that don't yet talk to each other, a written contract they will both implement, green CI. Next phase can pick either side.

---

## Phase 1 — ESP32: Wi-Fi, mDNS, `/status`

**Slice delivered:** Flash the ESP32, it joins your Wi-Fi using `secrets.h`, advertises `clapboard.local`, and `curl http://clapboard.local/status` returns a JSON blob with firmware version, free heap, uptime, and a `last_frame_at: null` indicator. No display interaction.

### What lands
- `src/net.{h,cpp}` (or inline in `main.cpp` if deferring modularisation): owns Wi-Fi connect, reconnect-on-drop, mDNS, an HTTP server with one route.
- `setup()` still holds MOSFET gates LOW first thing — non-negotiable safety invariant from CLAUDE.md.
- The typewriter demo is **paused, not deleted.** Either guard behind a build flag (`-D DEMO_TYPEWRITER`) or move to a `legacy/` example. This phase doesn't try to drive the panel at all.
- Pick and document async vs sync HTTP server.

### Acceptance tests
- Native: unit test for the `/status` JSON-builder helper (uptime formatting, version string assembly). Pure logic only.
- Hardware: ESP32 boots, serial log shows IP and "mDNS started." `ping clapboard.local` from the laptop succeeds. `curl http://clapboard.local/status` returns valid JSON matching `protocol.md`.
- Hardware: pull Wi-Fi router power, confirm reconnect within ~30 s when it returns.
- Negative: with a wrong password in `secrets.h`, firmware logs an error and doesn't brick. It should keep retrying, not crash-loop the watchdog.

### Risks
- **Windows mDNS without Bonjour is flaky.** Document the fallback (raw IP) in `protocol.md` and the README. Don't waste a phase fighting Windows mDNS quirks.
- **Wi-Fi power draw can sag the rail.** No interaction with EPD pins, but if you see brownouts when Wi-Fi connects, you'll need a beefier 3.3V regulator. Note for later.

### Hand-off
A reachable HTTP endpoint exists. Next phase adds the data plane.

---

## Phase 2 — `/frame` accepts a 48 KB POST and writes it to the panel — **keystone**

**Slice delivered:** From the laptop, `curl --data-binary @some_48kb.bin -H 'Content-Type: application/octet-stream' http://clapboard.local/frame` causes the e-paper to render that frame. End-to-end pixels-on-screen over Wi-Fi.

This phase proves the entire architecture works. It is the "is this project working?" demo for the rest of v1.

### What lands
- `/frame` POST handler. Validates `Content-Length == 48000`, validates content-type, streams body into a PSRAM buffer (8 MB available — use it).
- Thin `display::draw_frame(uint8_t*)` wrapper around `epd.drawInvertedBitmap`.
- `/status` extended with `last_frame_at`, `last_frame_bytes`, `last_frame_render_ms`.
- Error responses: 413 if too big, 400 if wrong size, 415 if wrong content-type, 503 if a refresh is already in flight.
- Default behaviour: partial refresh. Optional query param `?full=1` triggers a full refresh (clears ghosting).

### Acceptance tests
- Native: tests for request-validation helpers (size check, content-type check). Pure logic.
- Test fixture: a 48 KB binary generated from `tools/generate_slides.py` (e.g. `clapper_hero` slide) — canonical test frame for everything downstream.
- Hardware: `curl` the test fixture, panel renders the slate. Compare to the PNG preview in `tools/preview/`.
- Hardware: send a frame of all `0xFF` (all white), then all `0x00` (all black), confirm the panel actually goes white then black — proves the bit sense matches `protocol.md`. **This single test catches more bugs than any other.**
- Hardware: send 47999 bytes — expect 400. Send 48001 bytes — expect 400 or 413. Send wrong content-type — expect 415.
- Hardware: send two frames back-to-back fast; second should either queue or 503. Display must never corrupt.

### Risks
- **Bit sense bug.** Single most likely source of "I sent it and the screen is inverted." All-white/all-black test on day one locks it down.
- **Library body chunking.** ESP32 HTTP servers handling raw 48 KB bodies vary. If you chose async in Phase 1, validate body chunking works.
- **Refresh in flight.** Don't try to handle the next request inside the refresh — return 503 and let the client back off. The protocol doc should already say this; if not, fix the doc *and* the code in this phase.

### Hand-off
Pixels arrive over Wi-Fi. The firmware side of v1 is feature-complete (modulo `/sync` in Phase 7). All remaining phases are about giving humans a nice way to make those 48 KB.

---

## Phase 3 — Frontend skeleton: Vite app, canvas, "Send" posts a hardcoded frame

**Slice delivered:** `npm run dev` opens an editor page with an 800×480 canvas (zoomable to fit), a "Send to clapboard" button that takes whatever's currently rasterised on the canvas, packs it to 1bpp MSB-first, and POSTs to `clapboard.local/frame`. The canvas starts with one piece of placeholder text drawn by code, no editor UI yet.

### What lands
- React + Vite + TypeScript + Vitest. ESLint + Prettier configured.
- One `useFrameSink()` hook: takes a canvas element, returns `{ send, status, error }`.
- One `packFrame(canvas) → Uint8Array(48000)` pure function. Threshold-only for now (Floyd-Steinberg lives in Phase 6). MSB-first, `1 = ink`.
- Target host config — env var or settings panel — so it can hit `clapboard.local` or a raw IP.
- CORS handled on the firmware side. **Add the headers in firmware now or you'll think the frontend is broken when actually the browser silently dropped the response.**

### Acceptance tests
- Vitest: `packFrame` unit tests. Build a mock canvas with known pixels, assert exact byte output.
- **Vitest: oracle test using a fixture from `tools/generate_slides.py`.** Render the same image in PIL with the same threshold, pack with the same algorithm, assert byte-for-byte equality between the JS `packFrame` and the Python `encode_1bpp_msb`. This locks the format down for good.
- Vitest: hook test with a mocked fetch — confirms the right content-type and bytes go out.
- Hardware: `npm run dev`, click Send, the e-paper updates. Round-trip latency under ~3 seconds.
- Manual: kill the ESP32 mid-send, confirm the UI shows a useful error and doesn't lock up.

### Risks
- **CORS.** First thing that breaks if not handled.
- **Canvas pixel readback is sneaky:** `ctx.getImageData` returns RGBA; you need to threshold the luminance, not just check `r`. A common bug: "all-white image still produces all-zeros 1bpp."
- **Default target host:** `clapboard.local` works in dev, fails on guest networks. Make it overridable via UI.

### Hand-off
The full pipeline is alive. Anyone touching frontend after this point should not have to think about wire format.

---

## Phase 4 — Editor primitives: text boxes and shape tools

**Slice delivered:** The canvas is interactive. Click to place a text box, type into it, drag to move, resize handles. Shape primitives: rectangle, line, filled box. Layer panel showing each element. No persistence yet, no icons yet, no image upload yet.

### What lands
- Editor state model in the chosen state library (Phase 0 decision).
- Element types: `text`, `rect`, `line`. Common props: `x`, `y`, `w`, `h`, `rotation`, `locked`.
- Selection model, drag handles, basic keyboard shortcuts (delete, arrow-nudge).
- Render path: each element draws itself to the offscreen 800×480 canvas. Send button still works exactly the same.
- Text editing: monospace + one sans-serif, sizes 12/16/24/36/48, left/center/right align, multiline. **No rotation.** Anything else is Phase 4.5.

### Acceptance tests
- Vitest: state-reducer tests. Add element, move element, delete element. (No undo for v1.)
- Vitest: render-path tests using `node-canvas` or jsdom-canvas. Place a known text, confirm it shows up in the rasterised bytes at expected coordinates.
- Hardware: draw a clapperboard-ish layout from scratch in the editor, send it, confirm the panel matches what's on screen.

### Risks
- **Scope blowout.** Text editing alone can eat a whole phase if you let it. Stick to the must-haves listed under "What lands."
- **Resize handles + drag are fiddly.** This is why the Phase 0 spike of an editor library matters — don't half-implement and hand-roll a buggy version.
- **"Icons are basically just shapes, let's do them together"** — no. Icons need a chooser UI, asset pipeline, and rasterisation tests. Keep separate.

### Hand-off
The editor is genuinely useful for text + boxes. A user could make a real slate with just this.

---

## Phase 5 — Icon library

**Slice delivered:** A panel of ~25 film-related icons (clapboard, camera, microphone, slate, lens, reel, take number, scene, director's chair, light, tripod, megaphone, etc.) draggable into the canvas, positioned, resized, rendered as 1-bit.

### What lands
- `web/public/icons/` (or Vite-imported asset module) with curated SVGs. Source: permissively-licensed pack (Heroicons, Tabler, Lucide, or a custom set). Document source and licence.
- Icon picker UI panel.
- Icon element type with `src` + same `x`/`y`/`w`/`h`/`rotation` props as shapes.
- Rasterisation: render SVG to canvas at the placed size, threshold to 1-bit (icons are already 1-bit-friendly; dithering is overkill).

### Acceptance tests
- Vitest: icon registry — every advertised icon loads, has expected dimensions, rasterises without error.
- **Visual regression: snapshot the rasterised output of each icon at a fixed size, check into the repo, fail CI if any change.** This catches silent breakage.
- Hardware: build a slate with two icons, send, confirm panel matches preview.

### Risks
- **Tempted to include this in Phase 4.** Don't. Asset pipeline + licensing + visual snapshot tests deserve their own context window.
- **SVG-to-canvas rasterisation differs across browsers and headless test environments.** Pin the test rasteriser.
- **Icon licensing:** clarify before phase begins, not during code review.

### Hand-off
Editor has all the visual primitives a film slate needs.

---

## Phase 6 — Image upload with client-side dithering

**Slice delivered:** Drag a PNG or JPG onto the canvas, it appears as an image element, gets dithered to 1-bit (Floyd-Steinberg by default, threshold as alternative), placed/resized like other elements.

### What lands
- Drag-and-drop handler, file picker fallback.
- `dither.ts` module with at least Floyd-Steinberg. **Reference:** `tools/generate_slides.py:_to_1bit_dithered`. Match its visual character closely.
- Image element type. Dithered raster held in memory; original kept for re-dither at different sizes (design call: cache vs recompute on resize).
- Settings on the image element: dither algorithm dropdown, brightness/contrast pre-dither sliders.

### Acceptance tests
- Vitest: dither algorithm tests. Feed a known gradient, assert specific output bytes. **Use PIL output as oracle if you can match the algorithm exactly** — note PIL's FS dither serialises differently from naive implementations; beware.
- Vitest: full pipeline test — drop a known PNG into the editor state, render to 800×480 canvas, pack, assert against a golden fixture.
- Hardware: dither a photo of yourself, send to panel, confirm it looks like you.
- Hardware: large image (4K) doesn't crash the tab; OOM handled gracefully.

### Risks
- **Likely to under-scope.** Floyd-Steinberg is ~30 lines, but doing it well (correct serpentine pattern, error clamping, gamma-aware luminance) is more. Users will care a lot about dither quality on a 1-bit display — this is the most visible quality knob in the whole app. Budget for taste-tweaking iterations.
- **Big images on the main thread will jank the UI.** Web Worker is appropriate but adds complexity. For v1, do it on the main thread with a loading spinner; document as a known limitation.
- **Cache busting on resize:** if the user uploads then resizes, you need to re-dither at the new size. Decide policy.

### Hand-off
Editor is feature-complete per v1 scope.

---

## Phase 7 — Layout save/load (and `/sync` if hardware ready)

**Slice delivered:** Save the current canvas state to a named layout, load it back, list saved layouts, delete, rename. Storage is browser-side (IndexedDB). Optionally: `/sync` endpoint on firmware fires LED + solenoid.

### What lands
- Persistence layer in the frontend. JSON-serialise editor state. **Image elements need source data persisted too** — base64 in IndexedDB; localStorage will choke on the size.
- Layouts panel: list, load, save-as, delete, rename.
- Schema version on the saved blob; reject incompatible versions with a helpful message.
- (Optional) `/sync` firmware endpoint that triggers MOSFET gates per CLAUDE.md safety rules. **Only if hardware is wired.**

### Acceptance tests
- Vitest: save → load → re-render produces byte-identical output.
- Vitest: schema version mismatch is rejected with a clear error.
- Manual: save a layout, refresh the browser, load it back, send — display matches.
- (If `/sync` in scope) Native: pulse-duration safety cap (`SOLENOID_MAX_PULSE_MS` from `config.h`). Watchdog forces gate LOW even if handler hangs.
- (If `/sync` in scope) Hardware: scope the gate signal, confirm pulse width within spec, confirm forced LOW on simulated handler hang.

### Risks
- **IndexedDB API is verbose.** Pick `idb-keyval` or similar. Don't hand-roll.
- **Image data inflates layouts to MBs.** Quota limits are real. Document, monitor, have a "your storage is full" path.
- **`/sync` introduces new safety surface area** — battery check, button-debounce, accidental triggers. Treat as adjacent to but distinct from editor work. Splitting into Phase 7a (save/load) and 7b (`/sync`) is reasonable if hardware isn't ready.

### Hand-off
v1 is shippable.

---

## Phases tempted to combine — keep separate

- **4 + 5 (text/shapes vs icons).** Icons feel like "just another shape" but the asset pipeline, picker UI, and visual regression testing are separate concerns.
- **5 + 6 (icons vs image upload).** Both involve "putting a raster into the editor" but Phase 6's dithering quality work is its own beast.
- **1 + 2 (Wi-Fi vs `/frame`).** Tempting to "just do them together since the server's already running." Don't — Phase 1's value is having a brick-resistant networked device before sending it 48 KB blobs.
- **Phase 0 protocol doc and Phase 2 implementation.** Tempting to write the doc as you implement. Write it first; the doc is the contract.

## Phases at risk of context exhaustion

- **Phase 4 (editor primitives).** Text editing alone is deep. If the picked editor library bites back, the phase blows up. **Mitigation:** decide library in Phase 0, prototype the riskiest interaction (text-box-with-handles) in 30 min before committing.
- **Phase 6 (dithering).** Easy to ship "it works" then spend three more sessions chasing visual quality. **Mitigation:** define the quality bar with reference outputs from `tools/generate_slides.py` in Phase 0; ship when matched.
- **Phase 2 (`/frame`).** If async HTTP body handling on the S3 turns out fiddly with the chosen library, this phase could expand. **Mitigation:** in Phase 1, validate the library can receive a small POST body cleanly before Phase 2 commits to 48 KB.

## Phases that should fit comfortably in one session

0, 1, 3, 5, 7.

---

## How to start each phase

Recommended phase-kickoff prompt to a fresh Claude:

```
Read docs/phased-build-plan.md and CLAUDE.md.
We're starting Phase N: <name>.

The previous phase landed: <one-line summary>.
Acceptance criteria for this phase are in the plan doc.

Before any code: confirm you understand the slice, list the files
you intend to create/modify, list the tests you will write first,
and flag anything in the plan you'd push back on.

Then implement test-first: write the failing tests, then make them pass.
```

This forces a clear scope confirmation, prevents drift, and keeps the implementation honest.

## Don't forget

- Every phase ships with green CI.
- Every phase leaves the system in a working state — the typewriter demo stays runnable until Phase 4 of the firmware (where it gets explicitly retired in favour of "show last received frame, or boot screen if none").
- Conventional commits with `feat:` / `fix:` / `web:` / `hw:` / `docs:` / `test:` prefixes throughout.
- The all-white/all-black smoke test in Phase 2 catches more bugs than any other single test. Run it.
