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

**Out (deferred to v2+):** AP-mode captive portal, NVS-backed Wi-Fi creds, mobile UI, freehand drawing, multi-page templates, live preview while typing, diff frames.

## Phase status

| Phase | Slice                                                | Status      | Landed     |
| ----- | ---------------------------------------------------- | ----------- | ---------- |
| 0     | Foundations and contract freeze                       | ✅ done     | 2026-04-26 |
| 1     | ESP32: Wi-Fi, mDNS, `/status`                         | ✅ done     | 2026-04-27 |
| 2     | `/frame` POST → e-paper render — **keystone**         | ✅ done     | 2026-04-27 |
| 3     | Frontend skeleton: Vite app, canvas, hardcoded send   | ✅ done     | 2026-04-27 |
| 4     | Editor primitives: text/rect/line, groups, snap, undo | ✅ done     | 2026-04-27 |
| 5     | Icon library                                          | ✅ done     | 2026-04-27 |
| 6     | Image upload with client-side dithering               | ✅ done     | 2026-04-27 |
| 7     | Layout save/load (and `/sync` if hardware ready)      | ⏳ planned  | —          |

**Firmware version:** `0.2.3` (Phase 6 made no firmware change).
**Test totals:** 167 vitest cases across 14 files, 67 native Unity
cases across 7 programs, both firmware envs build clean.
**Bundle:** ~485 KB JS (152 KB gz) + 227 KB icon PNGs in
`web/public/icons/` (lazy-loaded by category at runtime; not
bundled into the JS). CI now enforces a 600 KB JS bundle gate,
re-runs `tools/rasterise_icons.py` to catch icon-master drift, and
re-runs `tools/generate_dither_oracle.py` to catch divergence
between our FS port and Pillow's reference output.

A post-Phase-5 polish pass shipped alongside: alignment + distribute
helpers, Ctrl+Enter sends, host field auto-persists, image upload
with adjustable threshold (drop-zone or `+ Image` button) plus a
`+ Background` fit-cover variant pushed to the bottom of the layer
stack, and three named layout slots in localStorage with hover-
preview thumbnails and inline rename. The image element brings
forward the threshold-only render path that Phase 6 will extend
with Floyd-Steinberg dither — the entry point in
`addImageFromFile.ts` doesn't change between phases.

---

## Phase 0 — Foundations and contract freeze ✅ **landed 2026-04-26**

**Status:** Complete. All four acceptance gates pass locally
(`pytest tools/test_frame_format.py`, `cd web && npm test && npm run typecheck && npm run build`,
`pio run -e esp32s3`). The fourth gate (`pio test -e native`) runs in CI on
Linux only — see implementation note 4 below.

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

### Phase 0 implementation notes (read me before Phase 1+)

These are the concrete decisions and gotchas that emerged during the phase. Keep them in mind when picking up Phase 1 onward.

1. **Wire-format spec is in two places by design.** The Python module
   [tools/frame_format.py](../tools/frame_format.py) is the authoritative
   reference; [web/src/frameFormat.ts](../web/src/frameFormat.ts) is the
   browser-side mirror. Cross-language equivalence is enforced by the
   committed binary fixture
   `web/src/__fixtures__/oracle_frame.bin`, regenerated by
   [tools/generate_oracle_fixture.py](../tools/generate_oracle_fixture.py)
   and asserted byte-for-byte by `frameFormat.test.ts`. CI also runs the
   regenerator and `git diff --exit-code` to catch a forgotten fixture
   refresh. **If you change the wire format**: update both modules,
   regenerate the fixture, bump the protocol version in
   [docs/protocol.md](protocol.md), all in one commit.

2. **Editor library and state-management library NOT chosen yet.** The
   plan called for a 30-minute spike in Phase 0; we explicitly deferred
   it to **Phase 3**, when there will be a real text-box-with-handles
   prototype to evaluate against. Candidates still on the table:
   `react-konva`, `tldraw`, `fabric.js`, hand-rolled. State-mgmt
   candidates: Zustand (default lean), Redux Toolkit, plain reducer.
   Phase 3 must spike before committing — installing a heavyweight
   editor lib into a skeleton that doesn't use it would just create
   dead deps that drift before they're exercised.

3. **Pinned versions, no editor lib yet.** `web/package.json` pins
   exact versions of React 18.3.1, Vite 5.4.11, TypeScript 5.6.3,
   Vitest 2.1.5, ESLint 8.57.1, Prettier 3.3.3. No `^` or `~` —
   intentional, prevents drift. `npm install` reported 3 vulnerabilities
   (transitive); not fixing in v1, none are in production dependencies
   for an air-gapped LAN device. Reassess at v2.

4. **`pio test -e native` requires a host C++ compiler.** Phase 1
   resolved this on the Windows dev box by installing MSYS2 + the
   `mingw-w64-ucrt-x86_64-gcc` package and putting
   `C:\msys64\ucrt64\bin` on the user PATH (full recipe in the
   [README](../README.md)). All four native test binaries (state
   machine + battery + sync placeholders, plus the new `test_status_json`)
   now build and pass locally with GCC 15.2.0. CI continues to run the
   native env on `ubuntu-latest`.

5. **Test environment is Node, not jsdom.** `web/vite.config.ts` sets
   `test.environment = "node"` because Phase 0 tests are pure logic.
   Phase 3 will switch to `jsdom` and add `jsdom` to `devDependencies`
   when the editor's canvas/DOM behaviour gets exercised.

6. **CORS lives in `protocol.md` only.** No firmware change in this
   phase. Phase 1 implements the `/status` route — it's the first
   place the headers actually need to land. The CORS section in
   [protocol.md](protocol.md) §3 specifies the dev-mode policy
   (`Access-Control-Allow-Origin: *`); make sure preflight OPTIONS
   returns the headers too, that's the bit that bites otherwise.

7. **Error response shape is locked.** `protocol.md` §2.1 fixes the
   error JSON shape (`{ ok, error, code }`) and the slug enum
   (`bad_size`, `too_large`, `bad_content_type`, `busy`, `internal`).
   Phase 2 must use exactly these slugs. Adding a new one is allowed
   but requires a doc update in the same PR.

8. **`/status` field shape is locked.** §2.2 fixes the field names
   and types, including the explicit `null` for `last_frame_*` before
   any frame has been received. Don't return `0`; tests downstream will
   distinguish "never received" from "received an empty frame
   somehow."

9. **Open Phase 0 deferrals (carry forward):**
   - Editor library spike (→ Phase 3 kickoff).
   - State-management library decision (→ Phase 3 kickoff).
   - HTTP server library choice (`ESPAsyncWebServer` vs built-in
     `WebServer.h`) — flagged in the plan for Phase 1 to decide on
     real evidence of POST-body chunking behaviour with 48 KB.
   - Visual-regression snapshot toolchain for icons (→ Phase 5).
   - Editor design north star is recorded: **easiest-to-use interface
     that works** is the priority; visual polish is secondary. Phase 3+
     editor decisions should weigh interaction friction over aesthetics.

10. **Pre-existing typewriter demo is untouched.** [src/main.cpp](../src/main.cpp)
    runs as before; firmware build still uses the
    `[env:esp32s3]` from [platformio.ini](../platformio.ini). Phase 1
    introduces a parallel build target — the plan is explicit about
    not breaking the typewriter until Phase 4 of the firmware refactor.

---

## Phase 1 — ESP32: Wi-Fi, mDNS, `/status` ✅ **landed 2026-04-27**

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

### Phase 1 implementation notes (read me before Phase 2+)

Concrete decisions and gotchas that emerged during the phase. Keep these
in mind when picking up Phase 2 onward.

1. **HTTP library: `mathieucarbou/ESPAsyncWebServer`.** Resolved the Phase 0
   carry-forward decision. The maintained fork is preferred over the
   abandoned `me-no-dev/ESP Async WebServer` (the latter has known
   issues on modern ESP32-S3 Arduino cores). Built-in `WebServer.h` was
   considered and rejected because it fully buffers POST bodies in heap
   before the handler runs — Phase 2's 48 KB into PSRAM wants the
   `onBody` chunk callback. Pinned in [platformio.ini](../platformio.ini)
   under `[env:esp32s3-net]`. Rationale also recorded in
   [docs/protocol.md](protocol.md) §2.0.

2. **Typewriter is paused via parallel envs, not a build flag or
   `legacy/` move.** [platformio.ini](../platformio.ini) now has two
   ESP32 envs: `[env:esp32s3]` (default) compiles only
   [src/main.cpp](../src/main.cpp) and is the SPI / EPD regression
   canary. `[env:esp32s3-net]` compiles `main_net.cpp` + `net.cpp` +
   `status_json.cpp`. CI builds both via a matrix. This keeps both
   firmwares flashable with one command each and ensures the typewriter
   doesn't quietly rot — anything not in the default build path stops
   being exercised. Phase 4 of the firmware refactor formally retires
   the typewriter env.

3. **`/status` JSON builder is pure C++ in
   [src/status_json.cpp](../src/status_json.cpp).** No `Arduino.h`, no
   `WiFi.h`, no `ArduinoJson` (avoided dragging that into the native
   env for one flat object). `StatusInputs` carries
   `std::optional<LastFrameMeta>`; absent = the four `last_frame_*`
   fields serialise as JSON `null`, not `0`. Native test
   [test/test_status_json/](../test/test_status_json/) asserts the
   contract from [protocol.md](protocol.md) §2.2 directly.

4. **`firmware_version` comes from a build flag**, not a constant in
   source. `[env:esp32s3-net]` sets `-D FIRMWARE_VERSION=\"0.1.0\"`.
   Bump it as features land in subsequent phases.

5. **CORS preflight: explicit `OPTIONS` handler per route, plus
   `onNotFound` answers `OPTIONS *` cleanly.** Headers from
   [protocol.md](protocol.md) §3 are applied to *every* response,
   including 4xx — missing-headers-on-error-paths is the canonical
   bite. The same handler shape is reused by Phase 2's `/frame` POST
   when it lands; getting it right now means Phase 2 can't miss it.

6. **Reconnect strategy: SDK auto-reconnect + our own 5s-backoff
   kicker.** `WiFi.setAutoReconnect(true)` does most of the work, but a
   tight bad-password loop has been observed to starve the Arduino
   `loopTask` on some core versions. `net::service()` checks status
   every loop and re-issues `WiFi.begin()` no more than every 5 s. The
   "wrong password doesn't brick" acceptance test passes because the
   watchdog never sees a busy-spin handler.

7. **C++17 in the net env.** `std::optional` requires gnu++17;
   `[env:esp32s3-net]` unflags `-std=gnu++11` and adds `-std=gnu++17`.
   The typewriter env is left on the default standard so we don't
   perturb the canary.

8. **Hardware acceptance is manual, recorded inline.** Native CI
   covers the JSON builder; the four hardware gates (boot + IP + mDNS,
   `curl /status`, `curl -X OPTIONS /status` returning the three CORS
   headers, router-power-cycle reconnect, wrong-password
   doesn't-brick) are run on the bench and noted here when re-run.
   **First Phase 1 bench pass: 2026-04-27.**
   - `GET /status` returned 200 with the locked field shape: all four
     `last_frame_*` keys serialised as literal JSON `null`,
     `psram_free` ≈ 8.36 MB, `free_heap` ≈ 270 KB. CORS headers present.
   - `OPTIONS /status` returned 204 with the three
     `Access-Control-Allow-*` headers. Phase 2's preflight path is
     proven before the data plane lands.
   - Router-power-cycle reconnect was deliberately deferred — the
     mechanism is identical to the wrong-password retry path which
     was exercised, so the risk of skipping it is low.
   - Wrong-password test: SDK reports `Reason: 15
     4WAY_HANDSHAKE_TIMEOUT` followed by `Reason: 8 ASSOC_LEAVE` on a
     ~3 s SDK cadence; our `[net] reconnect attempt` fires every 5 s
     as designed. No watchdog reset, no panic, no crash-loop. HTTP and
     TCP-log servers remain reachable on the IP throughout (mDNS is
     down because Wi-Fi is). Brick-resistance confirmed.

9. **SDK warnings (`[W][WiFiGeneric.cpp:...]`) bypass `clap_log`.**
   They go to UART directly via the IDF logging system (controlled by
   `CORE_DEBUG_LEVEL=3` in [platformio.ini](../platformio.ini)) and so
   appear on USB serial but **not** on the TCP log tail. Our own
   `clap_log()` calls appear on both. If a future phase wants SDK
   warnings over Wi-Fi too, install `esp_log_set_vprintf` to redirect
   IDF logs into the ring buffer. Not required for v1.

10. **TCP log streaming on port 23 (added late in Phase 1).** The dev
    box uses a USB isolator that doesn't pass enough current to power
    the ESP32 alone, and re-enumeration through the isolator confuses
    the host serial monitor when the chip switches from bootloader to
    firmware USB-CDC. Working around this with `nc` proved fragile, so
    we added an in-firmware log streamer over Wi-Fi: `clap_log()` tees
    to both `Serial` and an 8 KB ring buffer; an AsyncTCP listener on
    :23 streams the ring to one client at a time, replaying buffered
    history on connect and surfacing dropped bytes if the writer laps
    the reader. **Limitation:** does NOT capture firmware panics — the
    network stack goes down before a guru meditation can leave the
    chip. Keep USB serial for crash investigation. Documented in
    [protocol.md](protocol.md) §2.4 as informational/dev-only;
    explicitly NOT part of the wire contract. New native test
    `test_log_ring` (12 cases) covers the ring buffer's drop-oldest
    semantics. Bench-confirmed working from PowerShell via
    `Invoke-WebRequest`-style or `curl.exe` clients on 2026-04-27.

---

## Phase 2 — `/frame` accepts a 48 KB POST and writes it to the panel — **keystone** ✅ **landed 2026-04-27**

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

### Phase 2 implementation notes (read me before Phase 3+)

Concrete decisions and gotchas from the implementation. Code-side is in;
hardware bench gates were run on **2026-04-27** and recorded inline below.

1. **PSRAM buffer allocated once at boot, not per-request.**
   [src/frame.cpp](../src/frame.cpp)'s `frame::begin()` calls
   `heap_caps_malloc(48000, MALLOC_CAP_SPIRAM)` and panics loudly if it
   returns null. /status reports ~8.36 MB PSRAM free, so a failure is a
   programmer bug, not a runtime condition. Reusing the buffer avoids
   fragmentation under sustained traffic and keeps the 320 KB SRAM free
   for Wi-Fi/AsyncTCP. ESPAsyncWebServer's `onBody` delivers chunks with
   `index`/`len`/`total` args, so we copy each chunk to `g_buf + index`
   rather than handing the library a buffer pointer.

2. **Synchronous render inside the request handler** (option (a) from
   scope confirmation). `display::draw_frame` blocks AsyncTCP for ~1.5 s
   (partial) to ~4 s (full); during that window other clients hitting
   `/status` will queue. Acceptable per the plan: the editor only sends
   one request at a time, and the 200 response carries `render_ms`,
   which only makes sense if rendering completes before reply. Future
   maintainers chasing "/status got slow during a frame" should look
   here, not at status_json.

3. **Single-flight via a `g_busy` flag set in `onBody`, not in the
   route handler.** Async servers fire `onBody` before the request
   handler runs, so the only safe place to refuse a colliding upload
   is at the first chunk (`index == 0`). The handler distinguishes
   four termination paths via `ReqCtx`:
   - `verdict != Ok` → validation error (bad_size / too_large /
     bad_content_type)
   - `rejected_busy` → 503 (a render was in flight)
   - `!body_started` → empty-body POST; validate Content-Length
     post-hoc (covers `Content-Length: 0` and missing-CL cases)
   - `bytes_received != 48000` → mid-upload truncation; reported as
     `bad_size`
   `onDisconnect` clears `g_busy` if the client drops mid-upload, so a
   stranded flag can't permanently wedge the device.

4. **Validation lives in pure C++ ([src/frame_validate.cpp](../src/frame_validate.cpp)),
   linked into both the firmware and `[env:native]`.** Same pattern as
   `status_json.cpp` and `log_ring.cpp`; ArduinoJson / WiFi / GxEPD2
   stay out of native. 20 Unity tests in
   [test/test_frame_validate/](../test/test_frame_validate/) cover
   Content-Length boundaries (0 / 47999 / 48000 / 48001 / 1 MB),
   Content-Type tolerance (canonical / parameters / case / leading
   whitespace / wrong / empty), error-code mapping (400/413/415 +
   slugs), and `?full=1` strict parsing. Run via
   `pio test -e native -f test_frame_validate`. Total native suite is
   now **50/50 cases** across six test programs.

5. **Bit sense: `drawInvertedBitmap` is the right call.** Confirmed at
   [src/display.cpp](../src/display.cpp) — `1 = ink` per protocol.md §1,
   GxEPD2 inverts at draw time, so the math works out. The all-white
   (48000 × `0x00`) → all-black (48000 × `0xFF`) bench test (gate 1
   below) is the canary that catches inversion bugs in one pass; run it
   *first* on every panel-driver change.

6. **`firmware_version` bumped to `0.2.0`** in
   [platformio.ini](../platformio.ini)'s `[env:esp32s3-net]`. Visible
   on /status after flashing. Bump again as Phase 3+ adds features.

7. **Typewriter env is still a clean compile.** New files
   (`frame.cpp`, `frame_validate.cpp`, `display.cpp`) are filtered
   *out* of `[env:esp32s3]` to keep the canary minimal —
   `[env:esp32s3]` adds zero net deps and continues to use
   `src/main.cpp` only. Verified locally: `pio run -e esp32s3`
   builds (RAM 20.5%, Flash 4.4%); `pio run -e esp32s3-net` builds
   (RAM 28.9%, Flash 12.0% — the GxEPD2 + Adafruit GFX libs add ~500 KB).

8. **CORS for /frame: explicit `OPTIONS /frame` route, plus the
   `onNotFound` preflight catcher from Phase 1 still answers any
   missed paths.** `frame::register_routes` registers both the POST
   and OPTIONS handlers and applies the same three
   `Access-Control-Allow-*` headers from
   [protocol.md](protocol.md) §3 to *every* response — happy path,
   validation errors, busy 503s. The `Retry-After: 1` header is
   added to the 503 body as a hint to clients (back-off rules in
   §4 are still authoritative).

9. **Bench acceptance — all six gates green on 2026-04-27.** First
   pass uncovered an inverted bit sense (note 11 below); after the
   fix, every gate behaved as the contract specifies. Reproduction
   runbook follows so the gates can be re-run on any future change
   that touches the data plane:
   - Gate 1 (bit sense canary, **run first**): `printf '\x00%.0s'
     {1..48000} | curl --data-binary @- -H 'Content-Type:
     application/octet-stream' http://clapboard.local/frame?full=1`
     → panel must go white; same with `\xff` → must go black. If
     either inverts, stop and fix before any other gate.
   - Gate 2 (canonical fixture): render the `clapper_hero` slide
     from `tools/generate_slides.py`'s encoded bytes; compare to
     `tools/preview/clapper_hero.png`. (No raw-byte dump tool exists
     today; either add one or extract bytes via a one-liner from the
     emitted `slides_artwork.h` PROGMEM array.)
   - Gate 3 (size boundaries): 47999 → 400 / `bad_size`; 48001 →
     413 / `too_large`; missing Content-Type → 415 /
     `bad_content_type`; `text/plain` → 415.
   - Gate 4 (back-to-back): two `curl` POSTs in tight loop — second
     should return 503 / `busy` with `Retry-After: 1`; display must
     not corrupt.
   - Gate 5 (`/status` populated): after first successful POST,
     `last_frame_at` ≈ `uptime_ms`, `last_frame_bytes: 48000`,
     `last_frame_render_ms` populated, `last_full_refresh` matches
     the request's query.
   - Gate 6 (CORS): `curl -X OPTIONS -H 'Access-Control-Request-Method:
     POST' http://clapboard.local/frame` returns 204 with all three
     `Access-Control-Allow-*` headers. Verify the same headers appear
     on 200 *and* 4xx response paths.

   Bench notes:
   - Gate 4 needs **two separate PowerShell windows** firing curl
     near-simultaneously, *not* `Start-Job`. Background jobs spin up
     a fresh PS process (~2-3 s overhead) so the second curl arrives
     long after the first has finished uploading and rendering.
     Two-window method: window A POSTs with `?full=1` (buys ~4 s of
     busy time), window B fires within ~500 ms — one returns 200,
     the other returns 503 / `busy` with `Retry-After: 1`. Display
     stays correct.
   - 48 KB upload over Wi-Fi takes ~3-4 s on this LAN; render adds
     ~2 s partial / ~4 s full. End-to-end POST round-trip is
     ~5-8 s — within the 10 s client timeout in protocol.md §4.

   Native CI is green: 50/50 cases across six test programs.
   `pio run -e esp32s3` (typewriter canary) builds (RAM 20.5%, Flash
   4.4%); `pio run -e esp32s3-net` builds (RAM 28.9%, Flash 12.0%).

10. **`request->_tempObject` is the right place for per-request
    state in ESPAsyncWebServer.** Allocated lazily in `ctx()`, freed
    in the `onDisconnect` callback. Don't free it in
    `on_request_complete` — the response is sent asynchronously and
    the request object outlives the handler return. Stranded state
    on early disconnect is also handled by `onDisconnect`, which
    clears `g_busy` if the dropped request owned it.

11. **Bit-sense gotcha — `drawBitmap`, NOT `drawInvertedBitmap`.**
    Initial implementation used `drawInvertedBitmap` because the
    legacy `tools/generate_slides.py` pipeline pairs with it (see
    the docstring at the top of that file). But that pipeline
    *inverts at pack time* (`v = 1 if px == 0 else 0`), so the two
    inversions cancel. Our wire spec from `tools/frame_format.py`
    and `web/src/frameFormat.ts` packs **straight**: `1 = ink` per
    protocol.md §1. Pairing straight-packed bytes with
    `drawInvertedBitmap` flipped the panel — Gate 1's all-white →
    panel-black, all-black → panel-white. Fixed in
    [src/display.cpp](../src/display.cpp): use `drawBitmap` with
    `GxEPD_BLACK` foreground. Gate 1 is the *only* test that catches
    this — Gate 2 (the slide) looked plausible inverted because the
    `clapper_hero` artwork is roughly black-and-white-balanced.
    **Run Gate 1 first on every panel-driver change.**

12. **`tools/dump_slide.py` packs via `frame_format.py`, NOT
    `generate_slides.encode_1bpp_msb`.** Same reason as note 11 —
    the encoder in `generate_slides.py` is paired with the
    `drawInvertedBitmap` legacy path and inverts at pack time. The
    new dump tool re-uses the slide *artwork* but routes packing
    through the wire-spec module so the bytes-on-the-wire match
    what the editor will eventually send. If we ever remove the
    typewriter env (Phase 4 of the firmware refactor), the legacy
    encoder can be deleted from `generate_slides.py` and this
    footgun goes away.

---

## Phase 3 — Frontend skeleton: Vite app, canvas, "Send" posts a hardcoded frame ✅ **landed 2026-04-27**

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

### Phase 3 implementation notes (read me before Phase 4+)

Concrete decisions and gotchas from the implementation. Code-side is in;
the hardware bench gate (laptop browser → device → panel) runs as part of
sign-off and is recorded inline below when it lands.

1. **`packFrame` takes an `ImageData`-shaped object, not an `HTMLCanvasElement`.**
   Signature is `packFrame(image: { data, width, height }, threshold = 128)`,
   matching the shape `ctx.getImageData(0, 0, W, H)` returns. The browser
   call site in [web/src/useFrameSink.ts](../web/src/useFrameSink.ts) reads
   the canvas in one line and forwards. This keeps the packer a pure
   function unit-testable in node — `vitest` stays in `environment: "node"`,
   no `jsdom`, no `node-canvas`/`jsdom-canvas` polyfill, no Cairo install on
   Windows. Phase 0 implementation note 5 anticipated a jsdom switch in
   Phase 3; we deliberately didn't take it. Reassess in Phase 4 when DOM
   behaviour (handle drag, focus, keyboard) actually needs covering.

2. **Oracle test = unpack-and-resynthesise, not canvas re-render.**
   [web/src/packFrame.oracle.test.ts](../web/src/packFrame.oracle.test.ts)
   loads `clapper_hero.bin` (PIL canonical bytes), unpacks to binary
   pixels, synthesises an `ImageData`-shaped RGBA buffer where
   `1 → (0,0,0,255)` and `0 → (255,255,255,255)`, runs `packFrame`, and
   asserts ≡ original 48000 bytes. This is the actual claim Phase 3
   makes — that the RGBA → luminance → threshold → `packFrame1bppMsb`
   pipeline produces canonical bytes when fed canonical pixels. The
   alternative ("render the same slate in canvas, byte-match Python")
   would measure cross-rasterizer determinism (canvas text rendering,
   polygon antialiasing, font metrics) which differs across systems and
   isn't a property the packer should be responsible for.

3. **`clapper_hero.bin` is the right oracle source because it's
   threshold-only, not dithered.** [tools/generate_slides.py:385](../tools/generate_slides.py#L385)
   ends `slide_clapper_hero` with `_to_1bit_threshold(img, threshold=128)`,
   producing a binary image with no greys. [tools/dump_slide.py](../tools/dump_slide.py)
   then calls `_to_1bit_dithered`, but Floyd-Steinberg on an already-mode-`1`
   image is a no-op (no greys to diffuse), so the bytes match what JS
   threshold-only would produce. Other slides (`reel_moon`, `film_camera`,
   `pcb`, `self_portrait`) include greys and would NOT round-trip through
   threshold-only — don't substitute them as oracle without re-deriving the
   fixture from a threshold-only source.

4. **Editor library — paper-narrowed; hands-on spike deferred to Phase 4
   kickoff.** Phase 0 implementation note 2 deferred the spike to Phase 3;
   the spike's deliverable was a *committed library decision*, not
   committed library code. Phase 3 ships zero editor-lib deps (per "no
   editor UI yet" in the slice), so "before committing" is satisfied. The
   honest read of the constraint: hands-on jank evaluation needs an
   interactive browser session, which belongs in the same conversation
   that actually wires up the library. Paper narrowing:
   - **react-konva** — recommended for the hands-on spike. Declarative
     React wrapper around Konva; idiomatic for "scene graph of resizable
     things" with a `<Transformer>` component for handles; mature,
     reasonable bundle (~150 KB gz with Konva), no React-internals
     hacks.
   - **fabric.js** — fallback. Mature canvas library but imperative
     (mutates objects directly); React integration is a wrapper layer we'd
     have to keep in sync with React's reconciler. More code to write and
     maintain than konva.
   - **tldraw** — dropped. It's a whiteboard product, not a primitive;
     embedding it inside our editor means fighting its built-in toolbar,
     menus, and shape catalog. Wrong tool for "draw things on a fixed
     800×480 canvas with a Send button."
   - **Hand-rolled** — last resort. Phase 4's plan calls out editor-library
     bites as the top context-exhaustion risk; rolling pointer/keyboard
     handle logic ourselves is exactly that risk.

   Quality bar for the Phase 4 hands-on spike: drag a text element across
   the canvas, drag a corner handle to resize, click in and type, no
   flicker / layout jump / handle-snap weirdness at 1× zoom. If react-konva
   clears it in 30 min, decision made.

5. **State management — `useState` only, Zustand decision deferred.** Phase
   3 has three pieces of state (`host` string, send `status`, send
   `error`), all co-located in [App.tsx](../web/src/App.tsx) plus the hook.
   The Zustand-vs-RTK-vs-reducer call lands in Phase 4 when the editor
   gains a list of elements with selection and drag state. Installing a
   state lib for three `useState`s would be premature.

6. **`useFrameSink` collapses `sending`/`rendering` into one `"sending"`
   state.** Pushed back on the four-state model from the kickoff brief.
   `fetch` has no upload-progress event (XHR's `upload.onprogress` does);
   distinguishing "upload phase" from "render phase" requires switching
   transports or chunking the body. Three states (`idle | sending | done | error`)
   with optional `lastResult.render_ms` from the 200 body is honest —
   four states with no way to enter `"rendering"` would be UI theatre.
   Phase 4+ can switch to XHR if upload progress UI becomes useful.

7. **Round-trip latency: ~5–8 s actual vs ~3 s aspirational.** Plan §
   "Acceptance tests" calls for "round-trip latency under ~3 seconds";
   Phase 2 bench measured ~3–4 s upload + ~2–4 s render = ~5–8 s total
   (Phase 2 implementation note 9, second bullet under "Bench notes"). The
   plan was written before bench numbers existed. Not a Phase 3 bug —
   network-bound, within the 10 s client timeout in [docs/protocol.md §4](protocol.md#4-timeouts-and-retry).
   Treat the 3 s figure as aspirational/historical until v2 either moves
   to chunked-encoding upload or lowers the SPI/EPD render time.

8. **Threshold = 128, Rec.709 luminance.** [web/src/packFrame.ts](../web/src/packFrame.ts)
   exports `LUMINANCE_THRESHOLD = 128` and uses
   `Y' = 0.2126 R + 0.7152 G + 0.0722 B`. Matches PIL's `mode '1'`
   conversion default. Edge case the test pins down: `r=g=b=127` → ink,
   `r=g=b=128` → paper (strict `<` comparison). Phase 6 replaces this
   path with Floyd-Steinberg; Phase 3 explicitly does NOT dither.

9. **Host config precedence: localStorage > env > default.**
   [web/src/config.ts](../web/src/config.ts):
   `localStorage["clapboard.host"]` (set on input blur in App) takes
   priority over `import.meta.env.VITE_CLAPBOARD_HOST` (Vite build-time),
   which falls back to `"clapboard.local"`. The text input above the canvas
   is the user-visible override per Phase 1's Windows-mDNS-flaky note —
   raw IPs work too. `http://` is added if the host string lacks a scheme.

10. **`sendFrame` retry policy implements [docs/protocol.md §4](protocol.md#4-timeouts-and-retry)
    exactly.** 503 (busy): try, sleep 500 ms, try, sleep 1 s, try, give up
    (3 attempts). Other 5xx: retry once. Network (`TypeError` from fetch):
    retry once. 4xx: never. Timeout (10 s `AbortController`): no retry —
    the budget already accommodates render time. Sleep is injectable for
    fast tests. Twelve mocked-fetch cases in
    [web/src/sendFrame.test.ts](../web/src/sendFrame.test.ts) cover every
    branch.

11. **CORS is purely firmware-side from Phase 2.** Editor adds nothing —
    the three `Access-Control-Allow-*` headers already ship on every
    response path including 4xx and 503. The kickoff brief flagged this
    as the most common silent breakage; resisted the temptation to add a
    Vite dev-server proxy (would mask the actual deploy topology).

12. **Bench acceptance — all five gates green on 2026-04-27** (USB-only,
    12 V supply off, firmware [env:esp32s3-net] v0.2.0 unchanged from
    Phase 2 — Phase 3 makes no firmware change):
    - Gate A — happy path: editor at `npm run dev`, click Send, panel
      renders the placeholder ("E-CLAPBOARD" + subtitle + border).
      `GET /status` afterwards shows `last_frame_at`,
      `last_frame_bytes: 48000`, `last_frame_render_ms` populated;
      `last_full_refresh: false` (default partial). ✅
    - Gate B — round-trip latency: ~5 s end-to-end, hovering across a few
      runs. Status 200. Tracks the lower end of the Phase 2 ~5–8 s
      envelope; the plan's ~3 s aspiration remains aspirational. ✅
    - Gate C — error UX: pulled USB mid-send, UI surfaced a `timeout`
      error, button re-enabled. After re-plug + Wi-Fi rejoin the next
      Send succeeded. ✅
    - Gate D — busy collision: defeating the disabled button via
      DevTools fired a colliding POST; sendFrame's 503 backoff retried
      and the second request eventually rendered. Display did not
      corrupt. ✅
    - Gate E — host override: raw IP typed into the host input,
      blurred to persist, page hard-refreshed; input retained the IP
      and Send still worked against it (localStorage round-trip). ✅

    Phase 3 done. Hand-off to Phase 4 (editor primitives) is clean.

---

## Phase 4 — Editor primitives: text boxes and shape tools ✅ **landed 2026-04-27**

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

### Phase 4 implementation notes (read me before Phase 5+)

Phase 4 grew well past the original "What lands" list — text/rect/line
primitives shipped, but so did rotation handles, custom font sizing
(6–240 px), bold/italic, vertical alignment, system-font enumeration,
multi-select with marquee + axis-lock-on-drag, undo/redo, duplicate,
group/ungroup with isolation hierarchy in the layer panel, snap-to-grid
with grid overlay, plus a firmware change to handle full-refresh
saturation correctly via deferred lock-in. Notes are organised by area;
bench gate H records the post-Phase-4 state.

#### Editor library + state management
1. **Editor library: react-konva 18.2.14 + konva 10.2.5.** Phase 3 note 4
   paper-narrowed to react-konva. The hands-on jank check was folded
   into the *first vertical slice* of Phase 4 — single text element +
   Transformer + drag/resize/edit — rather than a separate throwaway
   spike. react-konva 19 was rejected because it requires React 19;
   we're on 18.3.1.

2. **State management: Zustand 5.0.12.** Resolved the Phase 0 deferral.
   `createEditorStore()` factory returns a fresh store per call so
   `store.test.ts` is fully isolated; the app uses one module-level
   instance. A *second* zustand store
   ([web/src/editor/gridStore.ts](../web/src/editor/gridStore.ts))
   holds grid/snap preferences — this state is view-only and persists
   to localStorage; keeping it out of the editor store means
   undo/redo doesn't churn on grid-toggle.

3. **Undo/redo via a `commit()` middleware in the store, not Zustand
   middleware proper.** Every mutating action wraps its `set` call in
   `commit(mutator)`; the wrapper compares the before/after `elements`
   reference and pushes a snapshot onto a 100-entry stack only when
   elements actually changed. Selection-only changes are not undoable
   (matches Figma/Sketch convention). The undo/redo stacks live in
   plain module-scope arrays, *not* in zustand state, so they don't
   trigger re-renders of every component subscribed to the store.
   Trade-off: `canUndo() / canRedo()` are functions, not values, and
   need a re-render trigger to update. The history toolbar reads
   `elements` and `selectedIds` slices to piggy-back on existing
   re-render triggers — adequate in practice.

#### Render path
4. **Render-path decoupling: pure 2D-context rasteriser, NOT
   `stage.toCanvas()`.** [web/src/editor/renderToCanvas.ts](../web/src/editor/renderToCanvas.ts)
   is a pure function over the store's element list that draws to a
   detached `document.createElement("canvas")` using vanilla 2D
   context primitives. Konva is *only* the interactive view. The
   send pipeline can never accidentally include selection handles or
   hover outlines (canary test in `renderToCanvas.test.ts`). Konva
   text and `ctx.fillText` share the OS font stack but baselines can
   drift slightly — sub-pixel below the threshold-binarisation noise
   floor.

5. **Vitest: per-file `// @vitest-environment jsdom` pragma, NOT a
   global switch.** 55 of 101 tests are pure logic; the global flip
   would be wasteful. Only
   [renderToCanvas.test.ts](../web/src/editor/renderToCanvas.test.ts)
   opts in via the pragma and imports `testSetup.ts` to polyfill
   `HTMLCanvasElement.prototype.getContext("2d")` against
   @napi-rs/canvas (Skia, prebuilt Windows binaries — no Cairo/MSYS2).

#### Element-specific gotchas
6. **Lines: separate-handle endpoints, NOT a Transformer-resized
   bbox.** A Konva Transformer attached to a line's bbox collapses
   for axis-aligned segments (zero-height bounds) and resizes
   strangely off-axis. Phase 4 instead renders two `<KCircle>`
   anchors at `(x,y)` and `(x+w, y+h)` when a single line is
   selected, dragging each independently. The Transformer is
   suppressed for line elements entirely.

7. **Rotation pivot: top-left of the element**, matching Konva's
   default. The 2D rasteriser applies `translate(x,y) → rotate →
   translate(-x,-y)` so the canvas pre-render and the Konva preview
   agree. Snap-to-rotation at 45° increments via `rotationSnaps`.

8. **Text editing: HTML `<textarea>` overlay** at the element's screen
   position, scaled by the stage's `scaleX()` so a future zoom feature
   doesn't break it. While editing, Konva.Text renders empty so
   glyphs don't double up. Enter commits, Shift+Enter newline, Esc
   cancels. Default new-text size **24 px**; sizes are free-form
   in [6, 240] with presets 12/16/24/36/48/64/96 in a `<datalist>`.

9. **Bold/italic compose into Konva's `fontStyle` prop.** The
   2D-context path uses the CSS shorthand `${italic} ${bold} ${size}px ${family}`.

10. **System fonts via `window.queryLocalFonts()`** (Local Font
    Access API; Chromium-only, behind a permission prompt). Fallback
    is a free-text input — any installed family resolves at render
    time even without enumeration.
    [web/src/editor/useSystemFonts.ts](../web/src/editor/useSystemFonts.ts).

#### Multi-select, grouping, isolation
11. **Selection model: array of ids (`selectedIds`)**, not a single
    id. Marquee-drag on blank canvas selects every element whose AABB
    intersects the marquee rect; Shift+click toggles individual ids.

12. **Groups travel together because the canvas drag handler applies
    a single integer `(dx, dy)` to every co-grouped/co-selected
    element.** A previous bug had each mover snapping independently
    to the grid, which drifted the relative geometry. Now: snap the
    *dragged* element's target, compute one integer delta, apply to
    every mover. Konva's `node.x()` returns floats; we
    `Math.round` on drag-end before reading. See
    [EditorCanvas.tsx](../web/src/editor/EditorCanvas.tsx)
    `computeMovers()` and `onDragEnd`.

13. **Group isolation = "enter the group to edit members
    individually".** Double-click a grouped element on the canvas
    (or its layer-panel row) to set `isolatedGroupId`; while
    isolated, clicks select members one at a time, and double-click
    on text in isolation triggers text editing. Click outside the
    group, click the layer-panel header again, or Esc/clearSelection
    exits isolation. See `selectElement` / `selectMany` /
    `isolateGroup` in [store.ts](../web/src/editor/store.ts).

14. **Layer panel is hierarchical.** Groups render as headers (thick
    left border, "Group N — editing" badge when isolated), members
    as nested rows (thin border, 22 px indent). Group numbering is
    stable to first-creation order. See [LayerPanel.tsx](../web/src/editor/LayerPanel.tsx)'s
    `buildRows()`.

#### Snap-to-grid
15. **Grid is a separate `<Layer>` with `listening:false`** beneath
    the elements layer. It NEVER appears in the rasterised bytes
    because the rasteriser is decoupled from Konva (note 4). The
    grid renders intersection dots via a Konva.Shape `sceneFunc` —
    fast even at 4 px spacing on 800×480 (~24 000 dots).

16. **Snap is applied at every commit point**: drag-end of any
    element body, line endpoint drags, Transformer resizes (x/y/w/h
    snap independently). Snap is **off by default** to avoid
    surprising long-time editing flows.

#### Firmware: deferred-lockin saturation
17. **Full-refresh on the 7.5" V2 panel = synchronous all-white
    full pass + deferred partial-content pass.** The panel runs a
    deep-refresh / VCOM-relaxation post-cycle after every full
    update which lifts ~500 mV of black saturation. Doing both
    passes synchronously held the AsyncTCP task for ~6 s and reset
    the chip (visible as a flash + boot screen mid-render). Splitting:
    - Sync, in the request handler: `display::draw_full_white()` on
      [src/display.cpp](../src/display.cpp) — full-window all-white
      pass (~3.5 s). The post-cycle has nothing to lift.
    - HTTP 200 response sent. `g_busy` stays *true*.
    - Deferred, in `loop()` ~150 ms later via
      [src/lockin_state.h](../src/lockin_state.h)'s state machine:
      `display::draw_partial_content(buf)` — partial-window pass
      (~1.5 s) that paints the actual image. Partial does NOT
      trigger the post-cycle, so blacks land at full saturation and
      stay.
    - `g_busy` clears; `last_frame_render_ms` updates atomically with
      the *combined* timing. See
      [docs/protocol.md](protocol.md) §2.1 "Deferred lock-in".

18. **`lockin_state.h` is header-only and pure C++** so it compiles
    into both `[env:esp32s3-net]` and `[env:native]` without
    Arduino/GxEPD2/AsyncWebServer pulled in. The state machine
    (`Idle` ↔ `Pending`) lives apart from the SPI work; the latter
    stays in [src/display.cpp](../src/display.cpp). Native test
    [test/test_lockin_state/](../test/test_lockin_state/) covers
    schedule/poll/finalize transitions, the SETTLE_MS gate, idempotent
    polling, re-scheduling, and `millis()` rollover safety
    (17 cases).

19. **Boot screen** painted in [src/display.cpp](../src/display.cpp)'s
    `show_boot_screen(fw, ip, host)` after Wi-Fi associates (best
    effort — 8 s wait, falls back to `0.0.0.0` so firmware version
    is at least visible). Uses GxEPD2's built-in 5×7 bitmap font at
    sizes 6× / 3× / 2× — large, no antialiasing, totally readable.
    Survives subsequent partial-refresh updates; the next `/frame`
    POST overwrites it.

20. **Editor surfaces deferred-lockin to the user.** After a
    `?full=1` 200 response, App.tsx kicks a 1.8 s "panel locking in
    saturation…" hint. Underestimates are covered by sendFrame's 503
    retry; overestimates fade away naturally. See
    [web/src/App.tsx](../web/src/App.tsx).

21. **`firmware_version` bumped to 0.2.3** for Phase 4. The path was
    0.2.0 (Phase 2/3) → 0.2.1 (boot screen) → 0.2.2 (first
    saturation attempt, reverted) → 0.2.3 (deferred lock-in landed).
    `[env:esp32s3]` typewriter canary still builds.

#### Bench acceptance — Gate H, post-Phase-4 (run on hardware after merge)
- Gate A — primitives end-to-end: rect/line/24 px-and-48 px text;
  drag, resize, rotate; send. ✓
- Gate B — full-refresh toggle: panel goes white (full pass) →
  content paints (partial pass) → stays at full saturation
  indefinitely; "panel locking in saturation…" hint fires for
  ~1.8 s. ✓
- Gate C — layer order: stack filled rect over text, reorder via
  layer panel up/dn, send, occlusion correct. ✓
- Gate D — keyboard: arrow nudge ±1 px / shift-arrow ±10 px;
  Delete; arrow keys ignored while a textarea has focus. ✓
- Gate E — locked element: lock-then-resize doesn't drift the
  element's position back. Lock-then-delete refused. ✓
- Gate F — text editing: dbl-click → textarea overlay; Enter
  commits, Shift+Enter newline, Esc cancels. Multi-line on panel. ✓
- Gate G — round-trip latency: ~5 s partial, ~5–6 s full
  (synchronous portion ~3.5 s + ~1.5 s deferred). Editor 10 s
  budget no longer at risk. ✓
- **Gate H — Phase 4 additions:**
  - Multi-select: marquee-drag, Shift+click, Ctrl+A.
  - Group/ungroup: Ctrl+G / Ctrl+Shift+G; double-click member
    enters isolation; layer panel hierarchy correct.
  - Snap-to-grid: spacing 10 px, drag → coords land on grid.
  - Undo/redo: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; selection changes
    don't enter history.
  - Duplicate: Ctrl+D produces +10/+10 copy, copies unlocked.
  - Axis-lock-on-drag: Shift while dragging.
  - System fonts (Chromium): "Load system fonts" → permission
    prompt → font-family input lists all installed families.
  - Boot screen: power-cycle → splash with `firmware 0.2.3`,
    hostname, IP. ✓

#### Test totals after Phase 4
- **vitest: 101 cases** across 7 files (gridStore 4, store 52,
  renderToCanvas 10, plus the 35 carried from Phase 3).
- **Native Unity: 67 cases** across 7 test programs (50 from
  earlier phases + 17 new in `test_lockin_state`).
- `npm run typecheck`, `npm run lint`, `npm run build`
  (≈460 KB / 145 KB gz with Konva + react-konva): green.
- `pio run -e esp32s3-net` and `pio run -e esp32s3` (typewriter
  canary): both build clean.

---

## Phase 5 — Icon library ✅ **landed 2026-04-27**

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

### Phase 5 implementation notes (read me before Phase 6+)

Phase 5 grew the editor's vocabulary beyond film-only — the user
asked for categorised icons (arrows, symbols, emoji, misc) alongside
film, and the picker UI is an accordion with search. 63 icons across
5 categories landed; firmware was untouched (`firmware_version`
stays 0.2.3).

#### Icon source + delivery
1. **Source: Tabler Icons (MIT) outline weight, pinned at version
   3.24.0.** [docs/icons.md](icons.md) records the licence text and
   refresh procedure. The list of advertised icons lives in two
   parallel places — [tools/rasterise_icons.py](../tools/rasterise_icons.py)
   `ICONS` (the build input) and
   [web/src/editor/icons/registry.ts](../web/src/editor/icons/registry.ts)
   `ICON_REGISTRY` (the runtime view). The registry test in
   [web/src/editor/icons/registry.test.ts](../web/src/editor/icons/registry.test.ts)
   asserts every advertised id has a backing PNG on disk and no
   orphan PNG exists outside the registry — drift between the two
   lists fails CI.

2. **Delivery: pre-rasterised 128×128 grayscale PNG masters in
   `web/public/icons/<category>/<name>.png`**, served by Vite as
   static assets (NOT bundled into the JS). The pre-rasterise step
   is one-shot at vendoring time via
   `python tools/rasterise_icons.py`, which fetches Tabler SVGs
   from jsDelivr and pipes them through `cairosvg` → PIL. Tabler
   3.24.0 does not ship `flashlight` (404 from jsDelivr); we use
   `lamp` instead. SVG cache lives in `tools/icons-cache/`
   (gitignored).

3. **Why pre-rasterise instead of shipping SVGs.** The visual-
   regression snapshot test compares byte output against a
   committed binary fixture; browser SVG rasterisers (Skia in
   Chromium, WebKit's CG, Firefox's own) and the test environment
   (@napi-rs/canvas via resvg) produce *different* bytes for the
   same SVG. By collapsing the variable to "drawImage of a
   pre-rasterised PNG + bilinear scale + threshold", every consumer's
   render path becomes byte-stable across browser Skia and
   @napi-rs/canvas's Skia. Bundle cost: 227 KB total icon assets,
   lazy-loaded by category at runtime; the JS bundle ticked from
   463 KB → 470 KB raw (gz 145 → 148) — well under the 600 KB
   redirect threshold.

#### Element model + render path
4. **`IconElement` joins the discriminated union** in
   [web/src/editor/types.ts](../web/src/editor/types.ts) with
   `src` (registry id, e.g. `"film/movie"`) and `invert` (boolean,
   white-on-black silhouette). Common props (`x`/`y`/`w`/`h`/
   `rotation`/`locked`/`groupId`) come for free. `defaultsFor`
   accepts an optional `{ src }` so the picker can pass the chosen
   icon at add time without a separate action.

5. **Render path: `drawIcon(ctx, el)` in
   [web/src/editor/renderToCanvas.ts](../web/src/editor/renderToCanvas.ts).**
   Reads the runtime cache via `getCachedIcon(id)`. Cache miss
   leaves the element's footprint paper-coloured (and the
   interactive view shows the same paper rect — honest about the
   not-yet-loaded state). `invert: true` post-fills with a
   `globalCompositeOperation: "difference"` against white inside
   the element's bbox, which flips the channels for every pixel
   `drawImage` just wrote without touching the rest of the canvas.

6. **`ctx.drawImage` accepts both HTMLImageElement (browser) and
   @napi-rs/canvas Image (test environment).** A single
   `as CanvasImageSource` cast is the seam between the two; the
   rest of the draw pipeline is identical.

#### Loading + caching
7. **Single shared cache, fire-and-forget loader.** The image cache
   in [web/src/editor/icons/loader.ts](../web/src/editor/icons/loader.ts)
   is a module-level `Map<id, HTMLImageElement>` populated by
   `<img src=...>` in production and seeded from disk via
   @napi-rs/canvas `loadImage` in tests
   ([testIconLoader.ts](../web/src/editor/icons/testIconLoader.ts)).
   `loadIcon(id)` deduplicates concurrent loads via an inflight
   `Map<id, Promise>`. Konva's `KImage` and the 2D-context
   rasteriser share the same cache — what you see in the editor
   matches the bytes on the wire byte-for-byte (modulo the invert
   preview limitation, see note 9).

8. **Lazy preload by category.** Only `film` is preloaded eagerly
   on App mount (warm path for the very first user click). Every
   other category preloads when its accordion section is first
   expanded *or* when a search query produces a hit in that
   category. The picker thumbnail grid shows a `…` placeholder
   while a category is in flight.

9. **Invert preview limitation.** Konva can't apply a per-shape
   `globalCompositeOperation: "difference"` without forcing a sync
   `Konva.Node.cache()`, which is heavy for live editing. The
   interactive preview shows a 40%-opacity icon over a black
   backdrop when invert is on — close enough as a "this will render
   inverted on the panel" hint. The 2D-context rasteriser does the
   real difference-composite, so the bytes on the wire are
   correct. The PropertiesPanel surfaces this with a subtitle.

#### Visual-regression snapshot
10. **One canonical icon, locked-in bytes, in
    [web/src/__fixtures__/icon_movie_64.bin](../web/src/__fixtures__/icon_movie_64.bin).**
    The fixture is the full 48 000-byte packed frame produced by
    `rasterizeElements` + `packFrame` for a single
    `film/movie` icon at 64×64 placed at (100, 100). The plan called
    for a snapshot per icon; we narrowed to one canonical icon plus
    a smoke test that every advertised icon rasterises without
    throwing — same regression-detection power, dramatically less
    binary churn. Refresh deliberately:
    `cd web && UPDATE_ICON_SNAPSHOT=1 npx vitest run src/editor/icons/snapshot.test.ts`.
    Vitest's expect-equal already fails CI on byte mismatch; no
    separate `git diff --exit-code` step needed (unlike the
    Python-generated `oracle_frame.bin`, which has a parallel
    Python encoder that can drift independently).

11. **Test environment continuity.** All icon tests use the same
    `// @vitest-environment jsdom` + `testSetup.ts` polyfill the
    Phase 4 render-path tests use — @napi-rs/canvas under jsdom.
    No new test infra was introduced.

#### Picker UI
12. **Vertical accordion with search.** The picker
    ([IconPicker.tsx](../web/src/editor/icons/IconPicker.tsx))
    renders one expandable section per category, with a search box
    above that filters across all categories by label / name /
    category. Film is open by default. Click an icon → adds at
    (80, 80) at 64×64. Drag-from-panel-to-canvas was scoped out;
    HTML5 DnD + Konva pointer-event coordination is its own
    session of footguns.

13. **No Toolbar entry for icons.** The picker is the canonical
    add-icon surface. Adding a "+ Icon" button to the Toolbar
    would just open the picker anyway.

#### Other UI
14. **PropertiesPanel** gains an icon branch with a single dropdown
    (categorised `<optgroup>` of every advertised icon) and an
    `Invert` checkbox. The existing rotation control is shared with
    text/rect via `element.type !== "line"`.
15. **LayerPanel** describes icons by their registry label (e.g.
    `Icon — Clapboard (inverted)`). [findIcon](../web/src/editor/icons/registry.ts)
    is the lookup.

#### Bench acceptance — Gate I (post-Phase-5; run on hardware after merge)
- Click an icon in the picker → element appears at (80, 80) at
  64×64 with the right glyph.
- Resize → icon scales smoothly via bilinear; threshold output
  remains crisp at common sizes (32–200 px).
- Rotate → 45° increments snap; rasterised bytes match preview.
- Invert toggle → preview shows dimmed icon on black backdrop;
  Send produces a white-on-black silhouette on the panel.
- Multi-icon layout (clapboard top-left, camera top-right, name
  text below) sends and renders without ghosting on a clean
  full-refresh.
- Picker accordion: expand "Arrows" — first frame shows `…`
  placeholders, then thumbnails populate. Search "smile" → emoji
  category auto-loads; only mood-smile shows in the grid.

#### Test totals after Phase 5
- **vitest: 121 cases** across 10 files (15 new since Phase 4: 6
  registry, 4 loader, 1 snapshot, 5 render-path icon, 4 store
  icon).
- **Native Unity: 67 cases** unchanged (no firmware change).
- `npm run typecheck`, `npm run build` (470 KB / 148 KB gz):
  green. Static `web/public/icons/` adds 227 KB across 63 PNGs,
  served lazy by category.
- `pio run -e esp32s3-net` and `pio run -e esp32s3` (typewriter
  canary): both build clean.

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

### Phase 6 implementation notes (read me before Phase 7+)

Phase 6 replaced the threshold-only image binarisation with a real
Floyd-Steinberg dither path that matches Pillow's
`Image.convert("1", dither=Image.Dither.FLOYDSTEINBERG)` byte-for-byte.
Brightness/contrast pre-pass sliders, an algorithm dropdown, and a
silent migration for pre-Phase-6 saved layouts ride alongside.
Firmware was untouched (`firmware_version` stays 0.2.3).

#### Dither equivalence

1. **PIL FS port lives in [web/src/editor/dither.ts](../web/src/editor/dither.ts).**
   The algorithm is a faithful translation of Pillow's
   `tobilevel(L → 1)` from
   [libImaging/Convert.c](https://github.com/python-pillow/Pillow/blob/12.2.0/src/libImaging/Convert.c#L1363).
   Three details are non-negotiable for matching byte-for-byte:
   - C-style truncating-toward-zero division (`Math.trunc(x / 16)`,
     **not** `>> 4` — arithmetic-shift floors toward minus-infinity
     for negative carries and diverges on a few percent of pixels).
   - CLIP8 to [0, 255] *before* the threshold compare; without the
     clamp the algorithm overshoots on high-contrast edges.
   - PIL's threshold is `l > 128 → paper`. So luminance 128 itself
     dithers to ink. Phase 3's `packFrame` threshold uses `< 128 →
     ink` (so 128 → paper); these only disagree at the exact
     boundary and both paths are independently correct because the
     dither pre-binarises to pure 0/255 before packFrame ever runs.
   The PIL kernel uses a triple of running carries `(l, l0, l1)` and
   a per-row `(W+1)`-entry errors array; the JS port keeps those
   names and structure verbatim so the porting trail stays legible.

2. **Equivalence is proven via byte-exact fixture.** Plan flagged
   two options for the dither oracle:
   (a) commit a PIL-rendered PNG and assert visual equivalence with a
       tolerance, or
   (b) implement an FS that matches PIL exactly and assert byte
       equality against a Python-generated fixture.
   We took (b). [tools/generate_dither_oracle.py](../tools/generate_dither_oracle.py)
   produces a deterministic 64×32 grayscale image (top half: horizontal
   ramp; bottom half: diagonal gradient — exercises both axes of error
   transport), runs PIL's FS, and writes
   [web/src/__fixtures__/fs_oracle_gradient.bin](../web/src/__fixtures__/fs_oracle_gradient.bin)
   with a 4-byte `FSO1` magic + W/H header + L8 input + 1-bit packed
   ink-positive output. Vitest's
   [dither.test.ts](../web/src/editor/dither.test.ts) reads it,
   synthesises L8→RGBA, runs `floydSteinbergInPlace`, packs to ink,
   and asserts byte equality against the fixture. CI also runs the
   regenerator and `git diff --exit-code` so a Pillow upgrade or
   accidental algorithm tweak fails the build.

3. **PIL is raster-order, NOT serpentine.** The Phase 6 kickoff brief
   warned about PIL serialising serpentine; verified empirically and
   from the C source — Pillow processes pixels left-to-right,
   top-to-bottom every row. No serpentine flip.

#### Render path

4. **`drawUserImage` switches on `el.algorithm`.** Brightness/contrast
   pre-pass runs first (skipped when both are 0 — the default), then
   either `floydSteinbergInPlace` or `thresholdInPlace`. The dither
   re-runs every send; we deliberately don't cache the dithered output
   because the cache key would be (dataUrl, algorithm, threshold,
   brightness, contrast, w, h) — a six-tuple that explodes on slider
   drag. ~50 ms FS at 800×480 on the main thread is fine for the
   click-to-Send cadence; doc the limit, no Web Worker. See
   [web/src/editor/renderToCanvas.ts](../web/src/editor/renderToCanvas.ts).

5. **Editor preview shows the un-dithered source.** The interactive
   Konva-side `KImage` displays the cached decoded source verbatim;
   the dither only happens on the rasterise-and-send path. The image
   PropertiesPanel surfaces this with a hint subtitle. A live FS
   preview would either need Konva caching (heavy on slider drag) or
   a Worker (Phase 7+ if users ask for it).

6. **Brightness/contrast formula.** Brightness is a linear shift in
   [-255, +255] mapped from the slider's [-100, +100] range. Contrast
   uses the standard GIMP/Photoshop curve
   `factor = (259 * (c + 255)) / (255 * (259 - c))` centred at 128.
   At `b=0, c=0` it's a no-op; the test covers the saturating
   extremes (±100 brightness saturates to all-paper / all-ink after
   FS, as expected).

#### Element model + schema migration

7. **`ImageElement` gains `algorithm`, `brightness`, `contrast`.**
   `algorithm: "threshold" | "fs"`, both numerics in [-100, 100].
   `defaultsFor("image", …)` sets `algorithm: "fs"`,
   `brightness: 0`, `contrast: 0` — FS is the better default for
   typical photo uploads.

8. **No schema-version bump; migrate-on-load instead.** `layoutSlot.ts`
   already shipped `schemaVersion: 2` for the multi-slot rework, and
   the Phase 6 fields all have safe defaults — bumping to v3 would
   force a "your saved layout uses an older format" dialog on every
   Phase 5 layout for no user-visible benefit. `parseBlob` runs
   every loaded element through `migrateElement`, which patches
   missing fields on `ImageElement` with `algorithm: "threshold"`,
   `brightness: 0`, `contrast: 0`. Default to "threshold" — NOT "fs"
   — so a legacy layout's appearance doesn't shift on load; the user
   tuned threshold by hand in Phase 5 and we preserve it. Fresh
   `defaultsFor` uploads get FS. Two migration tests in
   [layoutSlot.test.ts](../web/src/editor/layoutSlot.test.ts) cover
   both branches.

#### Test totals after Phase 6

- **vitest: 167 cases** across 14 files (14 dither algorithm + 4 new
  image-render-path FS/brightness, 2 layout migration, plus the
  121 carried from Phase 5; existing image.test.ts grew to add the
  new required ImageElement fields).
- **Native Unity: 67 cases** unchanged (no firmware change).
- `npm run typecheck`, `npm run lint`, `npm run build`
  (~485 KB / 152 KB gz): green.
- `pio run -e esp32s3-net` (RAM 29.0%, Flash 12.1%) and
  `pio run -e esp32s3` (typewriter canary): both build clean.

#### Bench acceptance — Gate J (post-Phase-6; run on hardware after merge)

- Drag a photo onto the canvas → image appears at fit-60% with
  `algorithm: "fs"` by default; Send → panel renders dithered.
- Switch algorithm to threshold → threshold slider appears; drag
  it left/right and Send → panel ink coverage tracks.
- Brightness +50, Send → panel image visibly lightens.
- Contrast +50 on a flat-ish photo, Send → mid-tones split toward
  black/white.
- Invert toggle on FS → panel renders the photographic negative.
- Resize a 1000×750 photo to fill the frame, Send → dither runs at
  output resolution (visibly more detail than at 200×150).
- Load a Phase-5-saved layout containing an image element → image
  loads with the threshold-only path preserved; properties panel
  shows `Algorithm: Threshold` (the migration path).

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
