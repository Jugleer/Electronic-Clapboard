# Bill of Materials

> Status: v1-final, as built and measured. Reflects the CAN-connected,
> robot-powered build through firmware Phase 17. Flesh out with part numbers, vendors, and prices
> once sourcing decisions are made.
>
> **The audio-sync subsystem and the battery subsystem are both gone.** See
> [wiring-guide.md](wiring-guide.md) "Phase 6" for the reasoning and the
> full topology; see the removed-parts table at the bottom of this file if
> you are working from an older build.

## Core electronics

| Part                                   | Qty | Notes                                           |
|----------------------------------------|----:|-------------------------------------------------|
| ESP32-S3-DevKitC-1 (N16R8)             |   1 | 16 MB flash, 8 MB PSRAM. Note the octal PSRAM consumes GPIO 33–37. |
| Waveshare 7.5" V2 e-paper + HAT        |   1 | 800 × 480, B/W, SPI. Rev 2.3+ recommended for the PWR-gate pin. |
| IRLZ44N N-channel MOSFET (TO-220)      |   1 | Logic-level, for the LED. (Was 2 — the solenoid one is gone.) |
| 12 V LED module                        |   1 | **Must be rated for CONTINUOUS 12 V operation** and draw **≤ 0.30 A**, so the ~0.10 A of logic and ~0.05 A of transceiver still fit inside the 0.5 A budget. An internal constant-current driver is fine — with the reservoir deleted there is no droop to upset it. The bench hold-mode leaves the LED lit for up to 30 s, so a pulse-only module would cook. |
| Small heatsink for the LED             |   1 | 0.14 W average at a 1.5 s cadence, so margin rather than necessity. |

## CAN interface

| Part                                   | Qty | Notes                                           |
|----------------------------------------|----:|-------------------------------------------------|
| SN65HVD230 transceiver breakout        |   1 | The common blue "VP230" board. **3.3 V part — VCC to 3V3, not 5 V.** Native 3.3 V logic, no level shifting needed. |
| 120 Ω resistor                         | 0–1 | Bus termination. Most breakouts have one fitted already — **verify, don't assume**: ~60 Ω across the assembled unpowered bus is correct (two 120 Ω in parallel). |
| 4-way harness connector                |   1 | +12 V, GND, CANH, CANL. Match whatever the Jugglebot CAN3 drop uses. Keyed, so the Schottky is belt-and-braces rather than the only defence. |

## Power — 12 V from the Jugglebot harness

The rail is **shared with the Jetson**. Total clapboard draw must stay under
**0.5 A at all times**, including the flash itself.

| Part                                  | Qty | Notes                                        |
|---------------------------------------|----:|----------------------------------------------|
| 12 V → 5 V buck converter             |   1 | Min 1 A output. |
| Inline fuse holder + **1 A** fuse     |   1 | Tight rating deliberately: the fuse is protecting the *shared rail*, not just the clapboard. (Was 5 A on the battery build.) |
| Schottky diode (SS34 or similar)      |   1 | Reverse-polarity protection. ~0.5 V drop at 0.5 A = 0.25 W. |


### Measured draw (2026-08-16, 12.0 V bench PSU)

| Condition | Draw |
|---|---|
| Idle, Wi-Fi associated | ~0.10 A |
| LED on, steady | 0.35 A |
| LED on + full-screen refresh | 0.38 A |
| + CAN transceiver | ~0.43 A total |

~0.07 A of headroom. Re-measure after any hardware change: set
`CLAPBOARD_LED_HOLD_MODE` to `1` in `include/config.h` and the fire button
becomes a hold switch so the LED can be left on while you read the PSU.

> **A 10,000 µF reservoir and a 27 Ω charge resistor were specified and then
> deleted.** They bought 5.4 W of flash against 4.2 W for direct drive — 1.3×
> for three parts and an inrush problem, because plug-in inrush (`V/R`) has to
> respect the same 0.5 A and that blocks exploiting the 3.3% duty cycle. Full
> reasoning in wiring-guide Phase 6.

## Operator controls

| Part                            | Qty | Notes                                                                  |
|---------------------------------|----:|------------------------------------------------------------------------|
| 6 mm tactile push button        |   1 | Fire button (GPIO 14) only. Button-to-GND wiring; firmware enables internal pull-up. **The wake button is gone** — deep sleep was retired in Phase 17 and it was the only wake source, so leaving it fitted risked a floating GPIO 2 sleeping the device with nothing able to wake it. |
| 3 mm or 5 mm LED                |   1 | Status indicator on GPIO 21. Any colour; green is conventional. |
| 330 Ω resistor                  |   1 | Status-LED current limiter (~5 mA at 3.3 V).                           |
| 10 kΩ resistor                  | 0–1 | **Optional** external pull-up for the fire button, paired with the 100 nF cap below. Only fit if firmware debounce alone doesn't suppress your switch's bounce. |
| 100 nF ceramic cap              | 0–1 | **Optional**, paired with the 10 kΩ resistor above for RC debounce.     |

## Passives

| Part                          | Qty | Notes                                 |
|-------------------------------|----:|---------------------------------------|
| 100 kΩ resistor               |   2 | MOSFET gate pulldowns. Still 2: the solenoid MOSFET position stays populated-but-unswitched, and an unpulled gate on a fitted FET can latch the load on. |
| 220 Ω resistor                | 1–2 | MOSFET gate series resistors          |
| 100 nF ceramic cap            |   2 | Local decoupling near e-paper, ESP    |

## Mechanical

- Enclosure (TBD — 3D printed likely). Position the fire button where the operator's thumb naturally rests.
- Strain relief for the harness drop — this cable will get tugged.
- **No hinge / clapper arm.** With audio sync cut there is no strike, so a moving clapper would be decoration that implies a function the device doesn't have.

## Removed since the battery build

| Part | Why |
|---|---|
| 3S LiPo (11.1 V) | Powered from the robot harness now |
| Standalone low-voltage cutoff module | Rail health is the robot's concern |
| LiPo balance-lead alarm | No pack to monitor |
| 5 A fuse | Replaced by a 1 A fuse — shared rail |
| 12 V push solenoid | Audio sync deferred to v2 |
| 1N5408 flyback diode | No inductive load left |
| Second IRLZ44N | No solenoid to switch (the *position* stays populated; see Passives) |
| 4700 µF / 35 V solenoid decoupling | No inductive load, and no reservoir either — the LED draws from the rail |
| Resonant strike block | Audio sync deferred to v2 |
| Rail ADC divider (10 kΩ / 2.2 kΩ) | No reservoir to monitor; a stiff supply is present or absent and the MCU browns out before a threshold would fire |
| Wake button | Deep sleep retired; it was also the only wake source |
| Bluetooth keyboard | The browser editor is the authoring path |
| USB OTG keyboard | Was never compatible with `ARDUINO_USB_CDC_ON_BOOT=1` claiming GPIO 19/20 |
