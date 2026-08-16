# Bill of Materials

> Status: v1-final list, reflecting the CAN-connected, robot-powered build
> (firmware Phases 11–17). Flesh out with part numbers, vendors, and prices
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
| High-power LED emitter                 |   1 | **Prefer a bare COB with an external current-set resistor over a module with an internal constant-current driver** — the reservoir droops from 12 V to ~9.5 V during a flash and internal drivers misbehave across that. See wiring-guide Phase 6. |
| Small heatsink for the LED             |   1 | 0.18 W average at a 1.5 s cadence, so this is margin rather than necessity. |

## CAN interface

| Part                                   | Qty | Notes                                           |
|----------------------------------------|----:|-------------------------------------------------|
| SN65HVD230 transceiver breakout        |   1 | The common blue "VP230" board. **3.3 V part — VCC to 3V3, not 5 V.** Native 3.3 V logic, no level shifting needed. |
| 120 Ω resistor                         | 0–1 | Bus termination. Most breakouts have one fitted already — **verify, don't assume**: ~60 Ω across the assembled unpowered bus is correct (two 120 Ω in parallel). |
| 4-way harness connector                |   1 | +12 V, GND, CANH, CANL. Match whatever the Jugglebot CAN3 drop uses. Keyed, so the Schottky is belt-and-braces rather than the only defence. |

## Power — 12 V from the Jugglebot harness

The rail is **shared with the Jetson**. Total clapboard draw must stay under
**0.5 A at all times**, including plug-in inrush and the flash itself.

| Part                                  | Qty | Notes                                        |
|---------------------------------------|----:|----------------------------------------------|
| 12 V → 5 V buck converter             |   1 | Min 1 A output. **Taps the rail before the charge resistor** — behind it, a flash would brown out the MCU. |
| Inline fuse holder + **1 A** fuse     |   1 | Tight rating deliberately: the fuse is protecting the *shared rail*, not just the clapboard. (Was 5 A on the battery build.) |
| Schottky diode (SS34 or similar)      |   1 | Reverse-polarity protection. ~0.5 V drop at 0.5 A = 0.25 W. |
| 10,000 µF / 25 V electrolytic         |   1 | Flash reservoir. Sized with the charge resistor — see the (C, R, gap) table in wiring-guide Phase 6; **they move together and the firmware cannot detect a mismatch**. |
| 27 Ω 5 W wirewound resistor           |   1 | Reservoir charge limiter. Bounds plug-in inrush to 0.44 A and sets recharge at 4RC ≈ 1.08 s. Doubles as inrush protection for the shared rail. |
| LED current-set resistor              |   1 | Value depends on your emitter's Vf: `R = (12 V − Vf) / I_peak`. ~2.5 Ω 5 W for a COB at Vf ≈ 9 V, I ≈ 1.2 A. |

### Optional: soft-start (only if you want a brighter flash *and* a short refractory)

Doubling the reservoir to 22,000 µF while keeping inrush legal forces the
charge resistor up, which pushes the refractory period to ~3 s. A soft-start
front-end decouples inrush from recharge so you can have both.

| Part                          | Qty | Notes                                 |
|-------------------------------|----:|---------------------------------------|
| P-channel MOSFET (e.g. DMP3098L, IRF4905) | 1 | Pass element |
| 100 kΩ resistor               |   1 | Gate pull-down                        |
| 10 µF capacitor               |   1 | Gate ramp — sets the soft-start slope |
| 10 V Zener diode              |   1 | Gate-source protection                |

## Operator controls

| Part                            | Qty | Notes                                                                  |
|---------------------------------|----:|------------------------------------------------------------------------|
| 6 mm tactile push button        |   2 | Wake button (GPIO 2), fire button (GPIO 14). Button-to-GND wiring; firmware enables internal pull-up. The wake button survives Phase 17's retirement of deep sleep as a Wi-Fi/config-mode control. |
| 3 mm or 5 mm LED                |   1 | Status indicator on GPIO 21. Any colour; green is conventional. |
| 330 Ω resistor                  |   1 | Status-LED current limiter (~5 mA at 3.3 V).                           |
| 10 kΩ resistor                  |   2 | **Optional** external pull-up for the buttons, paired with the 100 nF cap below. Only fit if firmware debounce alone doesn't suppress your specific switch's bounce. |
| 100 nF ceramic cap              |   2 | **Optional**, paired with the 10 kΩ resistors above for RC debounce.    |

## Passives

| Part                          | Qty | Notes                                 |
|-------------------------------|----:|---------------------------------------|
| 100 kΩ resistor               |   2 | MOSFET gate pulldowns. Still 2: the solenoid MOSFET position stays populated-but-unswitched, and an unpulled gate on a fitted FET can latch the load on. |
| 220 Ω resistor                | 1–2 | MOSFET gate series resistors          |
| 10 kΩ resistor                |   1 | Reservoir divider (top)               |
| **2.2 kΩ** resistor           |   1 | Reservoir divider (bottom). **Changed from 3.3 kΩ**: the old ratio put 12 V at 2.98 V on the pin, past the S3 ADC's well-calibrated ceiling of ~2.45 V — i.e. the fire gate was reading the least linear part of the curve. 10k/2.2k puts 12 V at 2.16 V. |
| 100 nF ceramic cap            |   2 | Local decoupling near e-paper, ESP    |

## Mechanical

- Enclosure (TBD — 3D printed likely). Position the wake and fire buttons where the operator's thumbs naturally rest.
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
| 4700 µF / 35 V solenoid decoupling | Superseded by the 10,000 µF flash reservoir |
| Resonant strike block | Audio sync deferred to v2 |
| Bluetooth keyboard | The browser editor is the authoring path |
| USB OTG keyboard | Was never compatible with `ARDUINO_USB_CDC_ON_BOOT=1` claiming GPIO 19/20 |
