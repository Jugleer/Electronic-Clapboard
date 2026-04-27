# Electronic Clapboard

## Project Overview

An electronic clapboard (film slate) for syncing multiple simultaneous camera angles with typed scene/take labels. Designed for outdoor use with excellent sunlight readability.

### Core functions
1. **Label display** — Scene/take info shown on a large e-paper display, input via Bluetooth keyboard
2. **Visual sync** — High-power LED flash (~50 ms pulse) visible to all cameras
3. **Audio sync** — Solenoid strike on a resonant block, producing a sharp transient detectable in post
4. **Timestamping** — Accurate time logged with each sync event for post-production alignment

### Hardware platform
- **MCU:** ESP32-S3-DevKitC-1 N16R8 (16 MB flash, 8 MB PSRAM)
- **Display:** Waveshare 7.5" V2 e-paper (800×480, B/W), SPI interface
- **Sync LED:** 12V high-power LED driven via IRLZ44N N-channel MOSFET (logic-level, TO-220)
- **Sync solenoid:** 12V push-type solenoid driven via IRLZ44N N-channel MOSFET with flyback diode
- **Input:** Bluetooth keyboard (Classic BT HID), with USB HID host as fallback
- **Power:** 3S LiPo (11.1V nominal) → direct to solenoid/LED rail, buck converter → 5V for ESP32 + peripherals
- **Protection:** Inline fuse (5A), firmware ADC voltage monitoring, standalone LVC module, balance-lead alarm

### Pin assignments (update as wiring is finalised)
```
# SPI — E-paper display (Waveshare 7.5" V2)
MOSI:   GPIO 11
CLK:    GPIO 12
CS:     GPIO 10
DC:     GPIO 9
RST:    GPIO 8
BUSY:   GPIO 7
PWR:    GPIO 6   # HAT rev2.3+ panel power enable (HIGH = on, LOW = off; image retained)

# MOSFET gates
LED_GATE:      GPIO 4   # → 220Ω → IRLZ44N gate (LED driver)
SOLENOID_GATE: GPIO 5   # → 220Ω → IRLZ44N gate (solenoid driver)

# Battery ADC
VBATT_ADC:     GPIO 1   # via voltage divider (10k/3.3k)

# USB OTG (fallback keyboard)
USB_D-:  GPIO 19
USB_D+:  GPIO 20
```

### Key constraints
- ESP32 GPIOs output 3.3V; MOSFETs must be logic-level (Vgs(th) well below 3.3V) — IRLZ44N satisfies this
- E-paper refresh is slow (~1–4s full, faster partial); only update between takes, not during
- Solenoid pulse: 30–80 ms, then OFF. Flyback diode mandatory (1N5408 or similar)
- LED pulse: ~50 ms. Brief overdrive above continuous rating is acceptable
- All high-current paths (solenoid, LED) return to pack GND via short, fat traces — not through the ESP's ground
- 100kΩ pulldown on each MOSFET gate to keep loads OFF during ESP boot (GPIOs float briefly)

### Software architecture
- **Framework:** Arduino (ESP32 Arduino Core) or ESP-IDF — TBD, but GxEPD2 library (Arduino) is the path of least resistance for the e-paper
- **State machine:**
  - `IDLE` — display shows current label, awaiting input
  - `EDITING` — keyboard input modifies label buffer, shown on e-paper (partial refresh)
  - `SYNC` — Enter key triggers: log timestamp, fire LED + solenoid simultaneously, update display
  - `LOW_BATTERY` — warning shown, sync disabled to protect pack
- **Libraries (expected):**
  - `GxEPD2` — e-paper driver
  - `BluetoothHID` or ESP-IDF BT HID host — keyboard input
  - Arduino `analogRead` — battery voltage monitoring

## Code standards

### Language & framework
- C++ (Arduino framework on ESP32-S3)
- PlatformIO as build system (`platformio.ini` at project root)

### Style
- Use `snake_case` for variables and functions, `PascalCase` for classes/structs, `ALL_CAPS` for constants and pin defines
- Group pin definitions and hardware constants in a single `config.h` header
- ISRs must be minimal: set a flag, defer work to `loop()`
- No blocking delays in main loop — use millis()-based timers or FreeRTOS tasks
- All magic numbers get named constants with units in the name (e.g., `SOLENOID_PULSE_MS`, `LOW_BATTERY_THRESHOLD_MV`)

### Safety rules (non-negotiable)
- MOSFET gate outputs must default LOW on boot. Verify with `pinMode(pin, OUTPUT); digitalWrite(pin, LOW);` at top of `setup()`
- Solenoid pulse must have a firmware-enforced maximum duration (`SOLENOID_MAX_PULSE_MS`). A watchdog or timer callback must force the pin LOW even if main code hangs
- Battery voltage must be checked before every sync event. Refuse to fire if below threshold
- Never drive both MOSFETs without the decoupling capacitors being confirmed in hardware

### Testing
- Unit tests for state machine logic, label parsing, voltage threshold logic
- Hardware-in-the-loop tests: verify MOSFET outputs with oscilloscope/logic analyser
- Test framework: PlatformIO native test runner (`pio test`) for pure-logic tests, manual verification for hardware

### Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `hw:`
- `hw:` prefix for hardware-related changes (pin reassignments, wiring doc updates, config changes)
- Branch per feature, merge to `main`
- Never commit secrets, WiFi credentials, or API keys

## Repository structure (current, post-Phase 5)

The repo evolved from "single-firmware ESP32 project" into "ESP32
firmware + browser editor", and split the firmware into a typewriter
canary plus a frame-sink network firmware. Two parallel PlatformIO envs
build them side-by-side, plus a `[env:native]` for pure-logic unit
tests. The Vite/React editor lives under `web/`. Phase 5 added a
categorised icon library — pre-rasterised PNG masters in
`web/public/icons/` plus registry/loader/picker UI under
`web/src/editor/icons/`; see [docs/icons.md](docs/icons.md).

```
electronic-clapboard/
├── CLAUDE.md                  # This file
├── README.md                  # Build + bench setup instructions
├── platformio.ini             # 3 envs: esp32s3 (typewriter), esp32s3-net, native
├── partitions/                # Custom 16 MB partition table
├── docs/
│   ├── phased-build-plan.md   # The roadmap; phase notes are load-bearing
│   ├── protocol.md            # HTTP wire contract (frame format, /status, etc.)
│   ├── icons.md               # Tabler vendor info, licence, refresh procedure (Phase 5)
│   ├── wiring-guide.md        # Breadboard wiring (Phase 0)
│   └── bom.md                 # Bill of materials
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
