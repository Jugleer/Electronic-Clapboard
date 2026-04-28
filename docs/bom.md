# Bill of Materials

> Status: working list. Reflects the breadboard-prototype build through Phase 8 (sleep/wake + fire button). Flesh out with part numbers, vendors, and prices once sourcing decisions are made.

## Core electronics

| Part                                   | Qty | Notes                                           |
|----------------------------------------|----:|-------------------------------------------------|
| ESP32-S3-DevKitC-1 (N16R8)             |   1 | 16 MB flash, 8 MB PSRAM                          |
| Waveshare 7.5" V2 e-paper + HAT        |   1 | 800 × 480, B/W, SPI. Rev 2.3+ recommended for the PWR-gate pin. |
| IRLZ44N N-channel MOSFET (TO-220)      |   2 | Logic-level; one for LED, one for solenoid       |
| 12V high-power LED module              |   1 | See notes on current draw / heatsinking          |
| 12V push solenoid                      |   1 | Short stroke, enough impulse to strike a block   |
| 1N5408 rectifier diode                 |   1 | Flyback across the solenoid                      |
| 4700 µF / 35 V electrolytic capacitor  |   1 | Solenoid rail decoupling                         |

## Operator controls (Phase 4 / Phase 8)

| Part                            | Qty | Notes                                                                  |
|---------------------------------|----:|------------------------------------------------------------------------|
| 6 mm tactile push button        |   2 | Wake button (GPIO 2), fire button (GPIO 14). Through-hole, 4-leg or 2-leg both fit. Button-to-GND wiring; firmware enables internal pull-up. |
| 3 mm or 5 mm LED                |   1 | Status indicator on GPIO 21. HIGH = awake. Any colour; green is conventional. |
| 330 Ω resistor                  |   1 | Status-LED current limiter (~5 mA at 3.3 V).                           |
| 10 kΩ resistor                  |   2 | **Optional** external pull-up for the buttons, paired with the 100 nF cap below. Only fit if firmware debounce alone doesn't suppress your specific switch's bounce. |
| 100 nF ceramic cap              |   2 | **Optional**, paired with the 10 kΩ resistors above for RC debounce.    |

## Passives

| Part                          | Qty | Notes                                 |
|-------------------------------|----:|---------------------------------------|
| 100 kΩ resistor               |   2 | MOSFET gate pulldowns                 |
| 220 Ω resistor                |   2 | MOSFET gate series resistors          |
| 10 kΩ resistor                |   1 | Battery divider (top)                  |
| 3.3 kΩ resistor               |   1 | Battery divider (bottom)              |
| 100 nF ceramic cap            |   2 | Local decoupling near e-paper, ESP    |

## Power

| Part                                  | Qty | Notes                                        |
|---------------------------------------|----:|----------------------------------------------|
| 3S LiPo battery (11.1 V nominal)      |   1 | Capacity TBD based on shoot-day runtime       |
| 12V → 5V buck converter               |   1 | Min 2 A output headroom. Low-quiescent variant preferred — the Phase 8 deep-sleep current (~0.3 mA target) is dominated by the buck's idle draw on a typical hobby buck (~3 mA). |
| Inline fuse holder + 5 A fuse         |   1 | On the pack + lead                             |
| Standalone low-voltage cutoff module  |   1 | Backup to firmware monitoring                  |
| LiPo balance-lead alarm               |   1 | Audible per-cell warning                       |

## Mechanical

- Resonant strike block (hardwood or aluminium, tuned for a sharp transient)
- Enclosure (TBD — 3D printed likely). Make sure the wake + fire buttons are positioned where the operator's thumbs naturally rest; mis-pressing wake when you mean fire is harmless, but mis-pressing fire when you mean wake burns 30–80 ms of battery for nothing.
- Hinge / clapper arm if mimicking a traditional slate visually

## Input

| Part                 | Qty | Notes                                             |
|----------------------|----:|---------------------------------------------------|
| Bluetooth keyboard   |   1 | Classic BT HID preferred (cheap foldable models). Optional once the browser editor is the primary input path. |
| USB OTG keyboard     |   1 | Fallback / wired input via GPIO 19/20             |
