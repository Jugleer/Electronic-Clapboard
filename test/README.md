# Tests

Two test environments are configured in [`platformio.ini`](../platformio.ini):

- **`native`** — host-side unit tests for pure logic (state machine, voltage thresholds, label parsing). Fast, no hardware needed.
- **`esp32s3`** — on-device tests for hardware-dependent code (battery ADC sampling, display driver wrapper). Requires the board connected.

## Running

```bash
# Pure-logic tests (host)
pio test -e native

# On-device tests
pio test -e esp32s3
```

## Folders

Each subfolder maps to an isolated test binary. PlatformIO discovers any `test_*` folder under `test/` automatically.

- `test_state_machine/` — state transitions, invariants
- `test_battery/` — voltage divider math, threshold + hysteresis logic
- `test_sync/` — pulse timing, safety cap enforcement

Keep hardware-free logic in functions that don't include `<Arduino.h>` so they can run under both envs.
