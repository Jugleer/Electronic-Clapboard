# Electronic Clapboard

## Project Overview

An electronic clapboard (film slate) for syncing multiple simultaneous camera angles with scene/take labels. As of Part II of the build plan it is a **peripheral on the Jugglebot robot's CAN harness** rather than a standalone battery device.

### Core functions
1. **Label display** — Scene/take info on a large e-paper display. Templates authored in the browser editor over Wi-Fi; per-take field values delivered over CAN by a ROS2 action.
2. **Visual sync** — High-power LED flash (50 ms pulse) visible to all cameras. Physical button only.
3. **Timestamping** — Wall-clock instant of each flash, slaved to the robot's CAN time-sync master and reported back to ROS2.
4. **Health proxy** — The panel doubles as a ROS2 liveness indicator: scene frame = ROS2 up, screensaver = something upstream is not.

> **Audio sync was cut in Phase 11** and is a v2 candidate. It was the highest-risk subsystem for the least return, and the rig has no separate audio recorder — the flash alone is a complete sync source. `PIN_SOLENOID_GATE` stays claimed and forced LOW so a populated MOSFET can't latch on.

### Hardware platform
- **MCU:** ESP32-S3-DevKitC-1 N16R8 (16 MB flash, 8 MB PSRAM). Note: the octal PSRAM consumes GPIO 33–37.
- **Display:** Waveshare 7.5" V2 e-paper (800×480, B/W), SPI interface
- **Sync LED:** High-power LED via IRLZ44N N-channel MOSFET, fed from a **local reservoir cap**, not the rail
- **Bus:** SN65HVD230 transceiver on the Jugglebot **CAN3** drop, 1 Mbps classic CAN
- **Input:** Browser editor over Wi-Fi (authoring) + CAN (runtime). No keyboard.
- **Power:** Jugglebot shared 12 V harness → buck → 5 V. **Hard budget: < 0.5 A at all times**, including plug-in inrush and the flash.
- **Protection:** 1 A inline fuse, reverse-polarity Schottky, firmware ADC reservoir monitoring

### Pin assignments
Canonical source is [include/config.h](include/config.h); the consolidated table with rationale is in [docs/wiring-guide.md](docs/wiring-guide.md).
```
# SPI — E-paper display (Waveshare 7.5" V2)
MOSI: 11   CLK: 12   CS: 10   DC: 9   RST: 8   BUSY: 7
PWR:  6    # HAT rev2.3+ panel power enable (HIGH = on; image retained when off)

# MOSFET gates
LED_GATE:      GPIO 4   # → 220Ω → IRLZ44N gate
SOLENOID_GATE: GPIO 5   # RESERVED, NEVER RAISED — claimed + forced LOW only

# CAN (TWAI) → SN65HVD230 transceiver.  Logic-level, NOT the differential pair.
CAN_TX:        GPIO 17
CAN_RX:        GPIO 18

# Buttons / status
WAKE_BUTTON:   GPIO 2   # button-to-GND, internal pull-up
FIRE_BUTTON:   GPIO 14  # button-to-GND, internal pull-up
WAKE_LED:      GPIO 21  # HIGH = awake

# Reservoir ADC — tapped at the CAP NODE, not the rail
VBATT_ADC:     GPIO 1   # via divider 10k/2.2k (was 10k/3.3k; see below)
```

**Unavailable on this board:** 26–32 (SPI flash), 33–37 (octal PSRAM on N16R8), 43/44 (UART0), 19/20 (native USB CDC), 48 (onboard RGB LED), 0/3/45/46 (strapping). GPIO 13 is technically free but is the Arduino-ESP32 default SPI MISO and gets reclaimed by `SPI.begin()` — this project already lost the status LED to it once.

### Key constraints
- ESP32 GPIOs output 3.3V; MOSFETs must be logic-level (Vgs(th) well below 3.3V) — IRLZ44N satisfies this
- E-paper refresh is slow (~1.5–3.5 s); only update between takes, not during
- **LED pulse is 50 ms and that is a floor, not a preference.** It must exceed one camera frame period or a sub-360° shutter can miss it entirely (24 fps = 41.7 ms frame, but a 180° shutter is open for only 20.8 ms of it). Do not shorten the pulse to increase brightness — brightness comes from the reservoir.
- **The 12 V rail is shared with the Jetson under a 0.5 A ceiling.** The flash draws from a local cap; the rail only ever sees recharge current. Plug-in inrush (`V/R`) is bound by the same ceiling and is what sizes the charge resistor.
- **Reservoir C, charge resistor R, and `MIN_FIRE_GAP_MS` move together.** `MIN_FIRE_GAP_MS >= 4RC`. The firmware cannot detect a mismatch; the Phase 12 voltage gate makes a stale constant *safe*, not *silent*. Sanctioned combinations are tabulated in wiring-guide Phase 6.
- The ADC divider is 10k/2.2k, not 10k/3.3k — the old ratio put 12 V at 2.98 V, past the S3 ADC's well-calibrated ceiling of ~2.45 V, i.e. the fire gate read the least linear part of the curve
- High-current LED return goes to harness GND via a star point — not through the ESP's ground, and not sharing a conductor with the CAN transceiver's ground return
- 100kΩ pulldown on each MOSFET gate to keep loads OFF during ESP boot (GPIOs float briefly)
- **The clapboard must transmit its CAN heartbeat unconditionally from boot.** The can-bridge gates all transmission on having seen a partner frame within 5 s; a clapboard that waits to be spoken to first never will be. This is the most likely bring-up trap.

### Software architecture
- **Framework:** Arduino (ESP32 Arduino Core), PlatformIO
- **Two transports, split by duty** — HTTP over Wi-Fi carries *authoring* (48 KB frames, screensaver slates, templates); CAN carries *runtime* (per-take field values, mode, fire timestamps). Pushing a frame over CAN would be 6,000 frames ≈ 0.67 s of 100% bus occupancy versus ~5 ms for a field update. Contract: [docs/protocol.md](docs/protocol.md) — §1–§6 HTTP, §8 CAN.
- **Display mode is the top-level state**, resolved from CAN liveness (protocol.md §8.5): screensaver on boot, scene template while ROS2 is up, screensaver again on any staleness. Every failure path converges on screensaver so the panel is readable as a health indicator.
- **Pure logic is header-only and linked into `[env:native]`** — `fire_state.h`, `power_state.h`, `lockin_state.h`, `screensaver_state.h`, and (Part II) `can_frames.h`, `region.h`, `clap_txn.h`. Hardware glue lives in the matching `.cpp`. This boundary is why cutting audio sync in Phase 11 required no change to the tested state machine.
- **Libraries:** `GxEPD2` (e-paper), `Adafruit GFX` (fonts, Part II), `ESPAsyncWebServer`, ESP-IDF `driver/twai.h` (CAN)

## Code standards

### Language & framework
- C++ (Arduino framework on ESP32-S3)
- PlatformIO as build system (`platformio.ini` at project root)

### Style
- Use `snake_case` for variables and functions, `PascalCase` for classes/structs, `ALL_CAPS` for constants and pin defines
- Group pin definitions and hardware constants in a single `config.h` header
- ISRs must be minimal: set a flag, defer work to `loop()`
- No blocking delays in main loop — use millis()-based timers or FreeRTOS tasks
- All magic numbers get named constants with units in the name (e.g., `LED_PULSE_MS`, `RAIL_MIN_FIRE_MV`)

### Safety rules (non-negotiable)
- MOSFET gate outputs must default LOW on boot. Verify with `pinMode(pin, OUTPUT); digitalWrite(pin, LOW);` at top of `setup()`. **This includes `PIN_SOLENOID_GATE`** even though nothing raises it — an unclaimed pin floats, and a floating gate on a populated MOSFET can latch the load on.
- The flash pulse must have a firmware-enforced maximum duration (`FIRE_MAX_PULSE_MS`), asserted at compile time. A hardware-timer ISR must force the gate LOW even if `loop()` hangs — it runs independent of FreeRTOS scheduling, AsyncTCP queue depth, and display SPI.
- Reservoir voltage must be checked before every sync event. Refuse to fire below `RAIL_MIN_FIRE_MV` (absolute floor) or below `FIRE_CAP_READY_FRACTION` of the observed idle baseline (relative gate). **Both gates, not either** — they fail differently: the timer is deterministic but assumes a compiled-in (C, R), while the voltage gate adapts to real hardware but depends on an ADC that could read wrong.
- **Never exceed 0.5 A draw from the 12 V harness.** It is shared with the Jetson. This is enforced by topology (flash from a cap, recharge through a resistor), not by firmware — do not add a code path that draws from the rail directly.
- Never drive the LED without the reservoir cap confirmed present and correctly polarised in hardware

### Testing
- Unit tests for state machine logic, label parsing, voltage threshold logic
- Hardware-in-the-loop tests: verify MOSFET outputs with oscilloscope/logic analyser
- Test framework: PlatformIO native test runner (`pio test`) for pure-logic tests, manual verification for hardware

### Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `hw:`
- `hw:` prefix for hardware-related changes (pin reassignments, wiring doc updates, config changes)
- Branch per feature, merge to `main`
- Never commit secrets, WiFi credentials, or API keys

### Commit cadence
- After any logical unit of work (passing tests + clean diff scoped to one concern), invoke /commit before starting the next task.
- Don't batch unrelated changes across multiple concerns into one commit cycle.

### Push policy (Claude is allowed)
- After a successful `/commit` cycle on `main`, Claude may run `git push` without asking — this is a deliberate carve-out from the harness's default "ask before push". The user has authorised the standing instruction in this `CLAUDE.md`.
- Push to the current upstream only (`git push`, or `git push -u origin <branch>` if no upstream is set yet on a feature branch). Never `git push --force` and never push to any remote other than `origin`. If the push is rejected (diverged history, protected branch, hook), report the error and stop — never force-push to recover.
- Never push uncommitted work, never push commits made via `--no-verify`, never push commits that include files matching the `Never commit secrets…` rule above.
- Never push on a feature branch the user is actively bisecting / rebasing — if you see in-progress rebase/cherry-pick state (`.git/rebase-*`, `.git/CHERRY_PICK_HEAD`), stop and surface the state to the user.
- Pushing on `main` is fine for this project (small team, fast iteration); the protected-branch / force-push prohibitions still apply.
- If asked to "commit and push" or "/commit then push", treat that as one operation: run /commit first, verify it succeeded cleanly, then push.

## Repository structure (current, post-Phase 11)

The repo evolved from "single-firmware ESP32 project" into "ESP32
firmware + browser editor", and split the firmware into a typewriter
canary plus a frame-sink network firmware. Two parallel PlatformIO envs
build them side-by-side, plus a `[env:native]` for pure-logic unit
tests. The Vite/React editor lives under `web/`. Phase 5 added a
categorised icon library — pre-rasterised PNG masters in
`web/public/icons/` plus registry/loader/picker UI under
`web/src/editor/icons/`; see [docs/icons.md](docs/icons.md).

**Part II (Phases 11–17) is in progress.** The tree below is
pre-Part-II except where noted; the modules Part II adds
(`can.*`, `can_frames.h`, `text_render.*`, `framebuffer.*`,
`template_store.*`, `region.h`, `clap_txn.h`) are specified in
[docs/phased-build-plan.md](docs/phased-build-plan.md) Part II but not
yet written. Two documents are load-bearing for that work and did not
exist before:

- **[docs/protocol.md](docs/protocol.md) §8** — the CAN wire contract.
  Cross-repository: the peer lives in the Jugglebot tree, so neither
  side may change §8 unilaterally.
- **[docs/can-integration-handoff.md](docs/can-integration-handoff.md)**
  — the implementation brief for the Jugglebot-side session (Teensy
  firmware, `teensy_bridge_node.py`, the `SetSlate` action). Written to
  be read *by a session working in the other repo*.

```
electronic-clapboard/
├── CLAUDE.md                  # This file
├── README.md                  # Build + bench setup instructions
├── platformio.ini             # 3 envs: esp32s3 (typewriter), esp32s3-net, native
├── partitions/                # Custom 16 MB partition table
├── docs/
│   ├── phased-build-plan.md   # The roadmap; phase notes are load-bearing
│   ├── protocol.md            # Wire contract: §1-6 HTTP, §8 CAN (cross-repo)
│   ├── can-integration-handoff.md  # Brief for the Jugglebot-side session
│   ├── icons.md               # Tabler vendor info, licence, refresh procedure (Phase 5)
│   ├── wiring-guide.md        # Wiring; "Phase 6" is the v1-final CAN + 12V build
│   └── bom.md                 # Bill of materials (v1-final, post-battery)
├── include/
│   ├── config.h               # Pin definitions, constants, thresholds
│   ├── secrets.h              # Wi-Fi credentials (gitignored)
│   └── secrets.h.example      # Template for new contributors
├── src/                       # Firmware
│   ├── main.cpp               # Typewriter demo (Phase 3 of original build) — canary
│   ├── main_net.cpp           # Phase 2+ entry: setup() / loop() for network firmware
│   ├── net.{h,cpp}            # Wi-Fi STA, mDNS, HTTP server lifecycle
│   ├── frame.{h,cpp}          # POST /frame handler + deferred-lockin orchestrator
│   ├── frame_validate.{h,cpp} # Pure validation helpers (linked into [env:native])
│   ├── lockin_state.h         # Pure deferred-lockin state machine (header-only)
│   ├── display.{h,cpp}        # GxEPD2 wrapper; draw_partial_content / draw_full_white / show_boot_screen
│   ├── status_json.{h,cpp}    # /status JSON builder (linked into [env:native])
│   ├── log_ring.{h,cpp}       # 8 KB ring buffer for log tee
│   ├── log_server.{h,cpp}     # AsyncTCP listener on :23 streaming the ring
│   └── clap_log.{h,cpp}       # printf-style logger that tees Serial + ring
├── tools/
│   ├── frame_format.py        # Python wire-format mirror; oracle for cross-language equivalence
│   ├── generate_oracle_fixture.py  # Regenerates web/src/__fixtures__/oracle_frame.bin
│   ├── rasterise_icons.py     # SVG→128px grayscale PNG vendoring (Phase 5; one-shot)
│   ├── generate_slides.py     # Legacy slide art used by the typewriter demo
│   └── dump_slide.py          # Pack a slide via frame_format and bench-flash it
├── web/                       # Browser editor (Phase 3+)
│   ├── package.json           # Pinned versions (Phase 0 implementation note 3)
│   ├── vite.config.ts         # node test environment; per-file jsdom for canvas tests
│   ├── public/
│   │   └── icons/             # Pre-rasterised PNG icon masters by category (Phase 5)
│   │       ├── film/          # 25 production-related icons (eager-loaded on App mount)
│   │       ├── arrows/        # 10 arrows (lazy-loaded on accordion expand)
│   │       ├── symbols/       # 12 geometric primitives + punctuation
│   │       ├── emoji/         # 8 mood-* faces
│   │       └── misc/          # 8 utility icons
│   ├── src/
│   │   ├── App.tsx            # Top-level wiring; preloads film icons on mount
│   │   ├── frameFormat.ts     # JS/TS mirror of tools/frame_format.py
│   │   ├── packFrame.ts       # ImageData → 1bpp MSB bytes (threshold-only)
│   │   ├── sendFrame.ts       # POST /frame with §4 retry semantics
│   │   ├── useFrameSink.ts    # React hook around sendFrame + packFrame
│   │   ├── config.ts          # Host resolution: localStorage > env > default
│   │   ├── editor/
│   │   │   ├── types.ts                # Element model (text/rect/line/icon/image)
│   │   │   ├── store.ts                # Zustand store with undo middleware
│   │   │   ├── gridStore.ts            # Snap/grid view-state (own zustand instance)
│   │   │   ├── EditorCanvas.tsx        # Konva stage; KImage for icon + image previews
│   │   │   ├── TextEditorOverlay.tsx   # HTML <textarea> overlaid on Konva.Text
│   │   │   ├── Toolbar.tsx             # Add-element buttons (text/rect/line)
│   │   │   ├── AlignButtons.tsx        # Align left/center/right/top/middle/bottom + distribute
│   │   │   ├── HistoryButtons.tsx      # Undo/redo/duplicate
│   │   │   ├── GroupButtons.tsx        # Group/ungroup
│   │   │   ├── GridControls.tsx        # Snap toggle, grid visibility, spacing
│   │   │   ├── LayoutButtons.tsx       # 3-slot localStorage save/restore + rename + hover preview
│   │   │   ├── LayerPanel.tsx          # Hierarchical: groups with nested members
│   │   │   ├── PropertiesPanel.tsx     # Per-element styling (incl. icon, image)
│   │   │   ├── renderToCanvas.ts       # Pure 2D-context rasteriser; drawIcon + drawUserImage
│   │   │   ├── addImageFromFile.ts     # FileReader → cache + addElement('image')
│   │   │   ├── imageCache.ts           # Decoded HTMLImageElement cache for image elements
│   │   │   ├── layoutSlot.ts           # Schema-versioned localStorage layout blob
│   │   │   ├── useKeyboard.ts          # Document-level shortcut wiring
│   │   │   ├── useSystemFonts.ts       # Local Font Access API (Chromium)
│   │   │   ├── testSetup.ts            # @napi-rs/canvas polyfill for jsdom tests
│   │   │   └── icons/                  # Phase 5
│   │   │       ├── registry.ts             # ID/category/label/src single-source
│   │   │       ├── loader.ts               # Image cache + lazy preloadCategory
│   │   │       ├── testIconLoader.ts       # Test-only disk loader via @napi-rs/canvas
│   │   │       └── IconPicker.tsx          # Accordion + search picker UI
│   │   └── __fixtures__/      # Binary oracle / snapshot fixtures (oracle_frame.bin, clapper_hero.bin, icon_movie_64.bin)
├── test/                      # Native (host-side) Unity tests via [env:native]
│   ├── test_state_machine/    # Original demo state machine
│   ├── test_battery/          # Voltage threshold logic
│   ├── test_sync/             # LED/solenoid pulse logic
│   ├── test_status_json/      # /status response shape contract
│   ├── test_log_ring/         # 8 KB ring buffer drop-oldest semantics
│   ├── test_frame_validate/   # POST /frame size/content-type/query parsing
│   └── test_lockin_state/     # Deferred-lockin state machine (Phase 4)
├── lib/                       # Local PlatformIO libraries (empty)
└── .claude/
    └── commands/
        ├── commit.md          # /commit — audit + test + commit
        └── audit.md           # /audit — code review
```

**Conventions:** `web:` is a valid commit prefix in addition to the
firmware ones (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `hw:`).
