# Electronic Clapboard

A DIY electronic clapboard (film slate) for multi-camera sync: typed scene/take labels on a sunlight-readable e-paper display, a high-power LED flash + solenoid strike for simultaneous visual/audio sync, and accurate timestamping for post-production alignment.

See [CLAUDE.md](CLAUDE.md) for the full project overview and code standards.

## Hardware

- **MCU:** ESP32-S3-DevKitC-1 (N16R8 — 16 MB flash, 8 MB PSRAM)
- **Display:** Waveshare 7.5" V2 e-paper, SPI
- **Sync:** 12V LED + 12V solenoid, each switched by an IRLZ44N logic-level N-MOSFET
- **Power:** 3S LiPo (11.1V nominal), buck regulator → 5V rail for the MCU

Full wiring is in [docs/wiring-guide.md](docs/wiring-guide.md). Follow the phased build — don't skip the standalone MOSFET tests.

## Build & flash

PlatformIO Core is installed into a project-local venv at `.venv/` to keep it isolated from any system Python. First-time setup:

```powershell
# From the project root, in PowerShell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install platformio
```

Day-to-day:

```powershell
# Activate the venv (once per terminal session)
.\.venv\Scripts\Activate.ps1

# Build
pio run

# Flash + open serial monitor
pio run -t upload -t monitor

# Just monitor (if already flashed)
pio device monitor
```

If you prefer not to activate, invoke the venv's `pio.exe` directly: `.\.venv\Scripts\pio.exe run`.

The VSCode PlatformIO extension works independently and doesn't need the venv — it ships its own Python + Core.

The `platformio.ini` assumes the board enumerates on **COM5**. If yours is different, either change `upload_port` / `monitor_port` in `platformio.ini` or create a local `platformio_override.ini` (gitignored) that redefines them.

### Native USB CDC

This firmware uses the ESP32-S3's **native USB CDC** rather than the CP210x UART bridge on the DevKitC. That means:

- Serial shows up as a standard USB COM device (no vendor driver needed on Windows 10+).
- The COM port number can change after flashing until Windows settles — re-check Device Manager if uploads start failing.
- To force the chip into the ROM bootloader if a bad flash bricks CDC: **hold BOOT, tap RESET, release BOOT**, then upload.

## Web editor (browser-side frontend)

From Phase 0 onward this repo also hosts the browser editor that produces frames for the panel. It lives under [web/](web/) (Vite + React + TypeScript + Vitest).

```bash
cd web
npm install
npm run dev        # Vite dev server (no editor UI yet — Phase 3+)
npm test           # Vitest, including the cross-language wire-format oracle
npm run typecheck  # tsc -b --noEmit
npm run build      # production build
```

The wire protocol (HTTP endpoints, frame byte layout, error responses) is locked in [docs/protocol.md](docs/protocol.md). The Python spec module at [tools/frame_format.py](tools/frame_format.py) and the JS mirror at [web/src/frameFormat.ts](web/src/frameFormat.ts) implement it; equivalence is enforced by a committed binary fixture under `web/src/__fixtures__/`.

## Tests

```bash
# Python wire-format spec tests (host)
pytest tools/test_frame_format.py

# Host-side firmware unit tests (state machine, threshold logic)
pio test -e native

# On-device firmware tests (hardware-in-the-loop)
pio test -e esp32s3

# Frontend tests
cd web && npm test
```

`pio test -e native` requires a host C++ compiler (`g++` / `gcc`) on PATH. On Linux/macOS this is usually present. **On Windows you'll need MinGW or MSYS2** — install one of them and ensure `g++.exe` is on PATH, otherwise PlatformIO's native env can't build the test binary. CI runs the native env on `ubuntu-latest`, so this is a dev-box convenience only.

## CI

The [GitHub Actions workflow](.github/workflows/ci.yml) runs four jobs on every push and PR:

1. `pytest tools/test_frame_format.py` + verify the oracle fixture is up to date.
2. `pio test -e native` (firmware host-side tests).
3. `pio run -e esp32s3` (firmware build only — no upload).
4. `web/` typecheck + test + build.

Any drift between the Python and JS wire-format encoders fails CI before merge.

## Repository layout

```
.
├── CLAUDE.md                  # Project overview + coding standards
├── README.md                  # This file
├── platformio.ini             # Build config (esp32s3 + native test env)
├── .github/workflows/ci.yml   # CI: pytest + pio + web
├── docs/
│   ├── protocol.md            # HTTP + frame format contract (Phase 0 lockdown)
│   ├── phased-build-plan.md   # Wireless editor build plan
│   ├── wiring-guide.md        # Phased breadboard build
│   ├── architecture.md        # Software architecture notes
│   └── bom.md                 # Bill of materials
├── include/
│   ├── config.h               # Pin defines, timing constants, thresholds
│   └── secrets.h.example      # Wi-Fi creds template (real secrets.h gitignored)
├── src/
│   └── main.cpp               # Firmware entry point
├── lib/                       # Local libraries (empty)
├── tools/
│   ├── frame_format.py        # Wire-format spec (authoritative)
│   ├── test_frame_format.py   # Spec tests
│   ├── generate_oracle_fixture.py  # Regenerates web/src/__fixtures__/oracle_frame.bin
│   └── generate_slides.py     # Demo-reel artwork → include/slides_artwork.h
├── test/
│   ├── test_state_machine/
│   ├── test_battery/
│   └── test_sync/
└── web/
    ├── package.json           # React + Vite + TS + Vitest skeleton
    ├── vite.config.ts
    ├── tsconfig*.json
    └── src/
        ├── frameFormat.ts     # JS mirror of tools/frame_format.py
        ├── frameFormat.test.ts
        ├── App.tsx
        ├── main.tsx
        └── __fixtures__/oracle_frame.bin   # Cross-lang oracle (committed)
```
