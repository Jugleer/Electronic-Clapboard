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

# Build the default env (typewriter demo — SPI / EPD canary)
pio run

# Build the Phase 1 network firmware (Wi-Fi + mDNS + /status)
pio run -e esp32s3-net

# Flash + open serial monitor (default env)
pio run -t upload -t monitor

# Flash the network firmware specifically
pio run -e esp32s3-net -t upload -t monitor

# Just monitor (if already flashed)
pio device monitor
```

Two ESP32 envs build side-by-side: `esp32s3` is the typewriter demo (the SPI / EPD regression canary, alive until Phase 4 of the firmware refactor) and `esp32s3-net` is the Phase 1+ network firmware. Pick whichever you want to flash; CI builds both on every push.

Before flashing the network firmware, copy `include/secrets.h.example` to `include/secrets.h` and fill in `WIFI_SSID` / `WIFI_PASSWORD`. The `secrets.h` file is gitignored.

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

`pio test -e native` requires a host C++ compiler (`g++` / `gcc`) on PATH. On Linux/macOS this is usually present. **On Windows**, install the MSYS2 UCRT64 GCC toolchain:

```powershell
# One-time setup (PowerShell, no admin needed)
winget install --id MSYS2.MSYS2 --silent --accept-package-agreements --accept-source-agreements
& "C:\msys64\usr\bin\pacman.exe" -Sy --noconfirm
& "C:\msys64\usr\bin\pacman.exe" -S --noconfirm --needed mingw-w64-ucrt-x86_64-gcc

# Persist on user PATH (open a fresh shell afterwards to pick it up)
$ucrt = 'C:\msys64\ucrt64\bin'
$cur  = [Environment]::GetEnvironmentVariable('Path','User')
if (($cur -split ';') -notcontains $ucrt) {
  [Environment]::SetEnvironmentVariable('Path', "$cur;$ucrt", 'User')
}
```

Verify with `g++ --version`, then `pio test -e native` from the project root. CI runs the native env on `ubuntu-latest`, so this is a dev-box convenience.

## Talking to the device (Phase 1+)

Once the `esp32s3-net` firmware is flashed and your laptop is on the same LAN:

```bash
# mDNS path — works on macOS / Linux / Windows-with-Bonjour
curl http://clapboard.local/status

# CORS preflight — should return 204 with the three Allow-* headers
curl -i -X OPTIONS http://clapboard.local/status

# Raw IP fallback — read the IP from the serial log
curl http://192.168.x.y/status

# Live firmware log stream over Wi-Fi (single client at a time, telnet-style)
nc clapboard.local 23
# or:  telnet clapboard.local 23
```

The `nc clapboard.local 23` tail is the workaround for "USB serial is unreachable" — useful when the device is on battery, behind a USB isolator, or otherwise out of reach. New connections see the last ~8 KB of buffered logs replayed first, then live lines. Caveat: this stream cannot capture firmware **panics** — when the chip throws, the network stack goes down before the panic message escapes. Use USB serial for crash investigation. The endpoint is documented in [protocol.md](docs/protocol.md) §2.4 as informational/dev-only.

**Windows mDNS gotcha:** Windows 10/11 without Bonjour or iTunes installed often fails to resolve `*.local` names reliably. If `ping clapboard.local` doesn't answer, fall back to the raw DHCP IP (printed on the serial monitor at boot). The browser editor will accept either.

## CI

The [GitHub Actions workflow](.github/workflows/ci.yml) runs five jobs on every push and PR:

1. `pytest tools/test_frame_format.py` + verify the oracle fixture is up to date.
2. `pio test -e native` (firmware host-side tests, including `/status` JSON builder).
3. `pio run -e esp32s3` (typewriter firmware build — SPI canary).
4. `pio run -e esp32s3-net` (Phase 1+ network firmware build).
5. `web/` typecheck + test + build.

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
│   ├── main.cpp               # Typewriter demo (env: esp32s3)
│   ├── main_net.cpp           # Phase 1+ network firmware entry (env: esp32s3-net)
│   ├── net.h / net.cpp        # Wi-Fi + mDNS + AsyncWebServer (Phase 1)
│   ├── status_json.h / .cpp   # Pure-C++ /status JSON builder (host-testable)
│   ├── log_ring.h / .cpp      # Pure-C++ ring buffer for log streaming (host-testable)
│   ├── clap_log.h / .cpp      # Firmware logging API: tees to Serial + ring
│   └── log_server.h / .cpp    # AsyncTCP listener on :23 streaming the ring
├── lib/                       # Local libraries (empty)
├── tools/
│   ├── frame_format.py        # Wire-format spec (authoritative)
│   ├── test_frame_format.py   # Spec tests
│   ├── generate_oracle_fixture.py  # Regenerates web/src/__fixtures__/oracle_frame.bin
│   └── generate_slides.py     # Demo-reel artwork → include/slides_artwork.h
├── test/
│   ├── test_state_machine/
│   ├── test_battery/
│   ├── test_sync/
│   ├── test_status_json/      # /status JSON builder unit tests (Phase 1)
│   └── test_log_ring/         # Log ring buffer unit tests (Phase 1)
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
