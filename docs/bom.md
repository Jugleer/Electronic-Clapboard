# Bill of Materials

> Status: stub. Flesh out with part numbers, vendors, and prices once sourcing decisions are made.

## Core electronics

| Part                                   | Qty | Notes                                           |
|----------------------------------------|----:|-------------------------------------------------|
| ESP32-S3-DevKitC-1 (N16R8)             |   1 | 16 MB flash, 8 MB PSRAM                          |
| Waveshare 7.5" V2 e-paper + HAT        |   1 | 800 × 480, B/W, SPI                              |
| IRLZ44N N-channel MOSFET (TO-220)      |   2 | Logic-level; one for LED, one for solenoid       |
| 12V high-power LED module              |   1 | See notes on current draw / heatsinking          |
| 12V push solenoid                      |   1 | Short stroke, enough impulse to strike a block   |
| 1N5408 rectifier diode                 |   1 | Flyback across the solenoid                      |
| 4700 µF / 35 V electrolytic capacitor  |   1 | Solenoid rail decoupling                         |

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
| 12V → 5V buck converter               |   1 | Min 2 A output headroom                        |
| Inline fuse holder + 5 A fuse         |   1 | On the pack + lead                             |
| Standalone low-voltage cutoff module  |   1 | Backup to firmware monitoring                  |
| LiPo balance-lead alarm               |   1 | Audible per-cell warning                       |

## Mechanical

- Resonant strike block (hardwood or aluminium, tuned for a sharp transient)
- Enclosure (TBD — 3D printed likely)
- Hinge / clapper arm if mimicking a traditional slate visually

## Input

| Part                 | Qty | Notes                                             |
|----------------------|----:|---------------------------------------------------|
| Bluetooth keyboard   |   1 | Classic BT HID preferred (cheap foldable models)   |
| USB OTG keyboard     |   1 | Fallback / wired input via GPIO 19/20              |
