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

## Repository structure (target)
```
electronic-clapboard/
├── CLAUDE.md                  # This file
├── README.md                  # Project overview and build instructions
├── platformio.ini             # PlatformIO build config
├── docs/
│   ├── wiring-guide.md        # Breadboard wiring instructions (phased)
│   ├── bom.md                 # Bill of materials
│   └── architecture.md        # Software architecture notes
├── include/
│   └── config.h               # Pin definitions, constants, thresholds (shared between src/ and test/)
├── src/
│   ├── main.cpp               # Entry point, setup/loop
│   ├── display.h / .cpp       # E-paper driver wrapper
│   ├── sync.h / .cpp          # LED + solenoid firing logic
│   ├── input.h / .cpp         # Keyboard input handling
│   ├── battery.h / .cpp       # Voltage monitoring
│   └── state_machine.h / .cpp # Core state machine
├── lib/                       # Local PlatformIO libraries (empty for now)
├── test/
│   ├── test_state_machine/
│   ├── test_battery/
│   └── test_sync/
└── .claude/
    └── commands/
        ├── commit.md           # /commit — audit + test + commit
        └── audit.md            # /audit — code review
```
