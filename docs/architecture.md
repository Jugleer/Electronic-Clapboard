# Software Architecture

> Status: draft. This document should evolve as the firmware takes shape.

## State machine

The firmware is organised around a small, explicit state machine. Transitions are driven by keyboard events, the sync trigger, and battery readings.

```
       ┌─────────┐  edit key   ┌──────────┐
       │  IDLE   │ ──────────▶ │ EDITING  │
       │         │ ◀────────── │          │
       └────┬────┘  Esc/done   └────┬─────┘
            │                        │
            │ Enter                  │ Enter
            ▼                        ▼
       ┌─────────┐               (commit label,
       │  SYNC   │  ◀────────────  enter SYNC)
       └────┬────┘
            │ done
            ▼
         IDLE

  Any state ──(vbatt < threshold)──▶  LOW_BATTERY  (sync disabled)
```

### State responsibilities

| State         | Enters on                      | Does                                                                 | Exits on                  |
|---------------|--------------------------------|----------------------------------------------------------------------|---------------------------|
| `IDLE`        | boot, sync complete            | show current label, wait for input                                   | edit key, Enter           |
| `EDITING`     | edit key pressed in IDLE       | accept keyboard input, partial-refresh label area                    | Enter (commit), Esc (cancel) |
| `SYNC`        | Enter from IDLE or EDITING     | log timestamp, fire LED + solenoid, full-refresh display             | pulse sequence complete   |
| `LOW_BATTERY` | battery read below threshold   | show warning, refuse to enter SYNC                                   | battery recovers (hysteresis) |

### Invariants

- SPI to the e-paper must never run concurrently with a sync event — ground bounce from the solenoid corrupts SPI transfers. `SYNC` is only reachable from `IDLE`, and `IDLE` is only entered once a refresh is complete.
- MOSFET gate pins are driven LOW the instant `setup()` starts. No code path after boot may leave them HIGH longer than `SOLENOID_MAX_PULSE_MS`.
- Battery voltage is sampled before each `SYNC`. A sample below threshold transitions to `LOW_BATTERY` instead of firing.

## Module layout (target)

| Module          | Responsibility                                                |
|-----------------|---------------------------------------------------------------|
| `main.cpp`      | `setup()`/`loop()`, wires modules together                     |
| `config.h`      | Pin defines, timing constants, thresholds (single source)      |
| `display.*`     | GxEPD2 wrapper, label rendering, refresh scheduling            |
| `sync.*`        | LED + solenoid pulse sequencing with a hard timer safety cap   |
| `input.*`       | BT HID keyboard (with USB HID host fallback), event queue      |
| `battery.*`     | ADC sampling + calibration, hysteresis for LOW_BATTERY         |
| `state_machine.*` | Pure logic: state + event → next state, no I/O                |

Keeping `state_machine` free of hardware calls lets us unit-test it in the `native` PlatformIO env.

## Concurrency

The Arduino core on ESP32-S3 runs on top of FreeRTOS. Guideline:

- **Main `loop()`** drives the state machine, display updates, and sync pulses.
- **Timer callback** enforces `SOLENOID_MAX_PULSE_MS` — forces the gate LOW even if `loop()` hangs.
- **BT HID callback** runs on a stack task; it must only push events into a queue (no direct state mutation).
- **ISRs** are off-limits for the sync logic — we use timers and FreeRTOS primitives instead.

## Open questions

- Bluetooth Classic HID vs BLE HID: Classic covers most cheap keyboards, BLE needs keyboards that advertise HID over GATT. Start with Classic.
- Label persistence across reboots: NVS? File on LittleFS? Probably NVS — labels are tiny.
- Timestamp source: millis() is fine for relative alignment; for wall-clock, we'd need a real-time clock or NTP (no WiFi in the field, so likely an RTC module later).
