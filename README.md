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

Prerequisites: [PlatformIO Core](https://platformio.org/install) or the VSCode extension.

```bash
# Build
pio run

# Flash + open serial monitor (combined)
pio run -t upload -t monitor

# Just monitor (if already flashed)
pio device monitor
```

The `platformio.ini` assumes the board enumerates on **COM5**. If yours is different, either change `upload_port` / `monitor_port` in `platformio.ini` or create a local `platformio_override.ini` (gitignored) that redefines them.

### Native USB CDC

This firmware uses the ESP32-S3's **native USB CDC** rather than the CP210x UART bridge on the DevKitC. That means:

- Serial shows up as a standard USB COM device (no vendor driver needed on Windows 10+).
- The COM port number can change after flashing until Windows settles — re-check Device Manager if uploads start failing.
- To force the chip into the ROM bootloader if a bad flash bricks CDC: **hold BOOT, tap RESET, release BOOT**, then upload.

## Tests

```bash
# Host-side unit tests (state machine, threshold logic)
pio test -e native

# On-device tests (hardware-in-the-loop)
pio test -e esp32s3
```

## Repository layout

```
.
├── CLAUDE.md                 # Project overview + coding standards
├── README.md                 # This file
├── platformio.ini            # Build config (esp32s3 + native test env)
├── include/
│   └── config.h              # Pin defines, timing constants, thresholds
├── src/
│   └── main.cpp              # Entry point (boot stub for now)
├── lib/                      # Local libraries (empty)
├── docs/
│   ├── wiring-guide.md       # Phased breadboard build
│   ├── architecture.md       # Software architecture notes
│   └── bom.md                # Bill of materials
└── test/
    ├── test_state_machine/
    ├── test_battery/
    └── test_sync/
```
