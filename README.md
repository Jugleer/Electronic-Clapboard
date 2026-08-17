# Electronic Clapboard

A DIY electronic clapboard (film slate) for multi-camera sync: scene/take labels on a sunlight-readable e-paper display, a high-power LED flash for visual sync, and accurate timestamping for post-production alignment.

As of Part II of the [build plan](docs/phased-build-plan.md) it is a **peripheral on the Jugglebot robot's CAN harness**: layouts are authored in a browser editor over Wi-Fi, and a ROS2 action pushes per-take field values over CAN3 at runtime.

---

## ⏸ Status: parked (2026-08-18)

**The project works and is paused, not abandoned.** It turned out to be less
useful than expected in the near term, so it is stopped at a deliberate
resting point rather than mid-change. The tree is clean, everything is
pushed, and CI is green.

### What actually works today

Flash `esp32s3-net`, and on the bench you can:

- Author a slate layout in the browser editor, mark text boxes as CAN fields, and push it to the device with **Send template**
- Fill those fields over HTTP and watch the panel composite them:
  ```
  curl "http://clapboard.local/slate?f2=SC%2014&f3=T%2003&f4=Wide%20-%20platform%20catch%20cycle"
  ```
- Press the fire button for a 50 ms LED flash
- Read device state from `GET /status`, including a `can` block
- Tail live logs over Wi-Fi with `nc clapboard.local 23`

The CAN link comes up, heartbeats at 10 Hz, and slaves its wall clock to the
bridge's `0x7DD` broadcast.

### Where it stops

| Area | State |
|---|---|
| Firmware Phases 11–17 | **Code complete**, both envs build, CI green |
| Phases 11, 12, 13, 14, 15 | Hardware-validated |
| Phase 14b (multi-line wrap) | Built, **not hardware-validated** |
| Phase 16 (CAN field ingest) | Built, **never seen a real CAN frame** |
| Phase 17 (mode arbitration) | Built, **never seen a real `CLAP_LINK`** |
| Jugglebot / Teensy side | **Partially done, parked on a side branch** — see below |
| Tests | 345 vitest across 23 files; 222 native Unity cases across 15 programs |

Phases 16 and 17 are unvalidated for one reason: they both hang off
`CLAP_LINK` (`0x7EA`), which the can-bridge does not send yet. Their pure
logic is unit-tested, but no frame has ever crossed the wire into them.

---

## Picking this back up

Three things, in order. The first two are independent and can be done in
either order; the third needs both.

### 1. Validate Phases 16 and 17 on the bench — half a day, no Teensy needed

[protocol.md §8.11](docs/protocol.md) is a complete runbook with the exact
CAN frames, including a worked transaction with a correct CRC. It needs a
USB-CAN adapter with periodic-TX support and nothing else.

Steps 4, 8 and 9 are the ones that matter: patch semantics, link-drop safety,
and the staleness backstop. Those are the failure modes that would otherwise
first appear during a shoot.

### 2. Finish the Jugglebot side — partially done, on a side branch

**Work exists and is parked.** As of 2026-08-18 the Jugglebot repo has:

| | |
|---|---|
| Branch | **`2026-08_clapboard-can3`**, pushed to origin |
| Contents | Nine commits — Phases 0–4 implemented and self-audited, a Phase 6 doc sweep, and a resume prompt |
| Plan document | `plans/parked/clapboard-can3-integration.md` |
| Main dev branch | `mvp-trajectory-bringup` was reset back to `d10f999` + 1; its **only** clapboard footprint is that plan file — no code, no tests, no firmware change, no logbook entries |

Resume with a worktree so the side branch does not disturb the main one:

```bash
git worktree add ~/Desktop/Jugglebot-clapboard 2026-08_clapboard-can3
```

> **Careful with the phase numbering.** "Phases 0–4" refers to that plan
> document's own numbering, which is **not** the same as the five work items
> in [can-integration-handoff.md](docs/can-integration-handoff.md) §3–§7.
> Nobody on this side has verified the mapping. Read
> `plans/parked/clapboard-can3-integration.md` first and work out what is
> genuinely done before assuming any of the handoff items are complete.

[docs/can-integration-handoff.md](docs/can-integration-handoff.md) remains the
brief written *for* a session in that repo. It leads with what already exists
there in your favour — notably, the entire clapboard→Jetson uplink needs no
new Teensy code at all, since every CAN3 frame is already relayed verbatim as
`CONE_FRAME`.

The five items it specifies, in suggested order: fix `cone_health` so it stops
reporting a catching cone when a clapboard is attached; add the `CLAP_LINK`
emitter; teach the Jetson's `CONE_FRAME` handler the new IDs; add the downlink
RPC; build the `SetSlate` action server.

Note also that the work was **self-audited, not hardware-validated** — the
same distinction that applies to Phases 16/17 on this side.

### 3. System integration test

Both ends together on the robot. Nothing has been written for this yet.

### Also worth doing at some point

- **`FreeSansBold24pt7b` at 2× is blocky for a hero field.** Generating true
  large GFX fonts from a TTF would be a real quality upgrade, and lands as
  new `FontId` entries so it invalidates no existing template.
- **The editor's glyph shapes are approximate.** Metrics are exact (that is
  what `tools/export_gfx_metrics.py` is for, and it is what makes the
  truncation preview trustworthy) but the preview draws with browser fonts.
  Blitting the actual GFX glyph bitmaps in canvas would make it pixel-exact.
- **Audio sync** — cut in Phase 11, a genuine v2 candidate. Re-adding it is
  one line in `fire::start_pulse()`; the ISR already clears both gates and
  the watchdog window already covers them.

---

## Architecture in one paragraph

Two transports, split by duty. **HTTP over Wi-Fi carries authoring** — 48 KB
frames, screensaver slates, templates and their field-region metadata.
**CAN carries runtime** — per-take field values, mode, fire timestamps. The
split is not stylistic: a 48 KB frame over classic CAN is 6,000 frames, about
0.67 s of *100%* bus occupancy, against ~5 ms for a field update. The panel's
display mode is the top-level state and is resolved from CAN liveness, so
"screensaver showing" is a true statement about upstream health in every
failure mode — which is why the device doubles as a ROS2 liveness indicator.

Fuller treatment in [docs/architecture.md](docs/architecture.md).

## Where the documentation lives

| Document | What it is for |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Project overview, pin map, coding standards, safety rules |
| [docs/protocol.md](docs/protocol.md) | **The contract.** §1–§6 HTTP, §8 CAN. §8 is cross-repository — the peer lives in the Jugglebot tree, so neither side may change it unilaterally. §8.11 is the bench runbook. |
| [docs/phased-build-plan.md](docs/phased-build-plan.md) | The roadmap and, more usefully, the per-phase implementation notes. Includes a "where the plan was wrong" section. |
| [docs/can-integration-handoff.md](docs/can-integration-handoff.md) | Implementation brief for the Jugglebot-side work |
| [docs/architecture.md](docs/architecture.md) | Module layout, the pure/impure boundary, concurrency contexts, init-order hazards |
| [docs/wiring-guide.md](docs/wiring-guide.md) | Phased breadboard build. "Phase 6" is the as-built CAN + 12 V design. |
| [docs/bom.md](docs/bom.md) | Bill of materials, as built and measured |
| [docs/icons.md](docs/icons.md) | Icon vendoring and refresh procedure |

**Read the implementation notes before changing anything.** Several decisions
look arbitrary and are not — the 50 ms flash floor, the ellipsis rules, why
`BUSY` is not a terminal transaction outcome, why the heartbeat must transmit
before the device has heard anything.

## Hardware

- **MCU:** ESP32-S3-DevKitC-1 (N16R8 — 16 MB flash, 8 MB PSRAM)
- **Display:** Waveshare 7.5" V2 e-paper (800×480, B/W), SPI
- **Sync:** 12 V LED module switched by an IRLZ44N logic-level N-MOSFET
- **Bus:** SN65HVD230 transceiver on the Jugglebot CAN3 drop, 1 Mbps classic CAN
- **Power:** Jugglebot 12 V harness (shared with the Jetson) → buck → 5 V. Hard budget < 0.5 A; **measured worst case 0.43 A**.

Two compile-time flags in [include/config.h](include/config.h) gate hardware
that is deliberately **not fitted** — `CLAPBOARD_HAS_RAIL_ADC` and
`CLAPBOARD_HAS_WAKE_BUTTON`. Enabling either without soldering the part is
worse than the missing feature: a floating ADC pin makes the fire button
intermittently refuse, and a floating wake-button pin can sleep the device
with no wake source.

Full wiring in [docs/wiring-guide.md](docs/wiring-guide.md).

## Build & flash

PlatformIO Core is installed into a project-local venv at `.venv/`. First-time setup:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install platformio
```

Day-to-day:

```powershell
.\.venv\Scripts\Activate.ps1

pio run -e esp32s3-net              # the real firmware
pio run -e esp32s3-net -t upload -t monitor
pio device monitor                  # if already flashed
```

Before flashing, copy `include/secrets.h.example` to `include/secrets.h` and
fill in `WIFI_SSID` / `WIFI_PASSWORD`. That file is gitignored.

Two ESP32 envs build side by side. **`esp32s3-net` is the firmware**;
`esp32s3` is a typewriter demo kept as an SPI/e-paper regression canary. CI
builds both.

`platformio.ini` assumes the board enumerates on **COM5**. Override
`upload_port` / `monitor_port` there, or create a gitignored
`platformio_override.ini`.

### Flashing this firmware for the first time erases on-device data

The custom partition table at [partitions/default_16MB.csv](partitions/default_16MB.csv)
renames the trailing data partition from `spiffs` to `slate_data` (LittleFS,
3.456 MB) for the screensaver slates and templates. The first flash with
`firmware_version >= 0.5.0` reformats it — anything previously at offset
`0xC90000` is lost. One-way at flash time; subsequent flashes are
non-destructive. Editor layouts live in browser IndexedDB and are unaffected.

### Native USB CDC

This firmware uses the ESP32-S3's **native USB CDC**, not the CP210x bridge:

- Serial appears as a standard USB COM device (no vendor driver on Windows 10+)
- The COM number can change after flashing — re-check Device Manager if uploads start failing
- To force the ROM bootloader if a bad flash bricks CDC: **hold BOOT, tap RESET, release BOOT**

## Web editor

Vite + React + TypeScript under [web/](web/).

```bash
cd web
npm install
npm run dev        # dev server
npm test           # Vitest — 345 cases
npm run typecheck
npm run build      # 600 KB bundle gate enforced in CI
```

Authoring flow: place text boxes, tick **CAN field** in the properties panel,
assign a field id 0–7 and a device font. The panel shows exactly where the
text will truncate on the device — the advance widths come from
[tools/export_gfx_metrics.py](tools/export_gfx_metrics.py), which parses the
firmware's own GFX font headers. CI regenerates and diffs the output so the
preview cannot silently start lying.

Then **Send template** with a slot number. The exported raster leaves CAN
field boxes blank; the firmware composites values into them at runtime.

## Tests

```bash
pytest tools/test_frame_format.py   # Python wire-format spec
pio test -e native                  # host-side firmware unit tests
cd web && npm test                  # frontend
```

`pio test -e native` needs a host C++ compiler on PATH. **This dev box does
not have one**, so CI (`ubuntu-latest`) is the gate for native tests — do not
assume a passing count without a run. To set it up locally on Windows:

```powershell
winget install --id MSYS2.MSYS2 --silent --accept-package-agreements --accept-source-agreements
& "C:\msys64\usr\bin\pacman.exe" -Sy --noconfirm
& "C:\msys64\usr\bin\pacman.exe" -S --noconfirm --needed mingw-w64-ucrt-x86_64-gcc

$ucrt = 'C:\msys64\ucrt64\bin'
$cur  = [Environment]::GetEnvironmentVariable('Path','User')
if (($cur -split ';') -notcontains $ucrt) {
  [Environment]::SetEnvironmentVariable('Path', "$cur;$ucrt", 'User')
}
```

A useful stopgap without a host compiler — syntax-check a test program with
the ESP toolchain:

```bash
"$HOME/.platformio/packages/toolchain-xtensa-esp32s3/bin/xtensa-esp32s3-elf-g++.exe" \
  -std=gnu++17 -fsyntax-only -Wall -I src -I include \
  -I "$HOME/.platformio/packages/framework-arduinoespressif32/tools/sdk/esp32/include/unity/unity/src" \
  test/test_clap_txn/*.cpp
```

## Talking to the device

```bash
curl http://clapboard.local/status
curl "http://clapboard.local/slate?f2=SC%2014&f3=T%2003"
curl http://clapboard.local/templates
nc clapboard.local 23               # live log tail
```

**Windows mDNS gotcha:** without Bonjour installed, `*.local` resolution is
unreliable. Fall back to the raw DHCP IP printed on the serial monitor at
boot; the editor accepts either.

The log tail replays the last ~8 KB then streams live. It cannot capture
firmware **panics** — the network stack goes down before the message escapes.
Use USB serial for crash investigation.

## CI

[GitHub Actions](.github/workflows/ci.yml) runs on every push:

1. `pytest tools/test_frame_format.py` + oracle-fixture drift check
2. `pio test -e native`
3. `pio run -e esp32s3` and `pio run -e esp32s3-net`
4. Font-metrics drift check — regenerates `fontMetrics.ts` and fails on a diff
5. `web/` typecheck + test + build

Any drift between the Python and JS wire-format encoders, or between the
firmware's fonts and the editor's metrics table, fails before merge.

## Repository layout

```
.
├── CLAUDE.md                  # Overview, pin map, standards, safety rules
├── platformio.ini             # 3 envs: esp32s3, esp32s3-net, native
├── partitions/                # Custom 16 MB table (slate_data = LittleFS)
├── docs/                      # See the documentation table above
├── include/
│   ├── config.h               # Pins, timings, CLAPBOARD_HAS_* flags
│   └── secrets.h.example      # Wi-Fi creds template
├── src/
│   ├── main_net.cpp           # Entry point — init order is load-bearing
│   ├── can.{h,cpp}            # TWAI transport, heartbeat, time-sync, ingest
│   ├── can_frames.h           # ○ Pure codec for every §8 frame
│   ├── clap_txn.h             # ○ Pure transaction machine
│   ├── mode_state.h           # ○ Pure §8.5 display-mode arbitration
│   ├── text_fit.h             # ○ Pure wrapping, ellipsis, alignment
│   ├── region.h               # ○ Pure template region model
│   ├── template_wire.h        # ○ Pure codec for template uploads
│   ├── slate.{h,cpp}          # Active template, mode driver, /slate
│   ├── framebuffer.{h,cpp}    # PSRAM Adafruit_GFX surface + clip rect
│   ├── text_render.{h,cpp}    # Font table, advance tables, draw_field
│   ├── template_store.{h,cpp} # LittleFS /templates/, atomic writes
│   ├── frame.{h,cpp}          # POST /frame — browser direct-to-panel
│   ├── screensaver.{h,cpp}    # Slate storage + awake cycle
│   ├── display.{h,cpp}        # GxEPD2 wrapper
│   ├── fire.{h,cpp}           # Fire button, LED pulse, watchdog ISR
│   └── net.{h,cpp}            # Wi-Fi, mDNS, HTTP, /status
├── tools/
│   ├── frame_format.py        # Wire-format spec (authoritative)
│   ├── export_gfx_metrics.py  # GFX fonts → web/src/editor/fontMetrics.ts
│   └── generate_oracle_fixture.py
├── test/                      # 15 native Unity programs
└── web/                       # Vite + React editor
```

**○ = header-only, Arduino-free, linked into `[env:native]`.** This is the
most load-bearing convention in the codebase: every rule worth arguing about
lives in one of those headers and is testable without hardware. The `.cpp`
files do transport, allocation and pixels.
