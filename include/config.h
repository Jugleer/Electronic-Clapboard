#pragma once

// Electronic Clapboard — hardware configuration
// Pin assignments mirror CLAUDE.md and wiring-guide.md. Update together.

#include <Arduino.h>

// --- SPI — Waveshare 7.5" V2 e-paper ---
constexpr uint8_t PIN_EPD_MOSI = 11;
constexpr uint8_t PIN_EPD_CLK  = 12;
constexpr uint8_t PIN_EPD_CS   = 10;
constexpr uint8_t PIN_EPD_DC   = 9;
constexpr uint8_t PIN_EPD_RST  = 8;
constexpr uint8_t PIN_EPD_BUSY = 7;
constexpr uint8_t PIN_EPD_PWR  = 6;   // HAT rev2.3+ panel power enable

constexpr uint32_t EPD_PWR_SETTLE_MS = 10;

// --- MOSFET gate drives ---
constexpr uint8_t PIN_LED_GATE      = 4;

// RESERVED, NOT DRIVEN (Phase 11). The audio sync element (solenoid strike
// on a resonant block) was cut from v1 — see docs/phased-build-plan.md
// Phase 11. The pin is still claimed, still pinMode(OUTPUT), still forced
// LOW at boot and by the pulse-end ISR, so a populated-but-unused MOSFET
// on the board can never latch on. Nothing raises it. Re-adding audio sync
// in v2 is a one-line change in fire::start_pulse() plus a pulse-width
// constant — deliberately kept that cheap.
//
// Why audio sync was cut: it was the highest-risk subsystem for the least
// return. The inductive kick is the reason docs/architecture.md forbids
// SPI concurrent with a sync event (ground bounce corrupts e-paper
// transfers), and syncing multiple *cameras* — with no separate audio
// recorder in the rig — is fully served by the visual flash alone.
constexpr uint8_t PIN_SOLENOID_GATE = 5;

// --- CAN (TWAI) — Jugglebot CAN3 drop ---
// The ESP32-S3 has one TWAI controller (classic CAN 2.0B, no FD). It needs
// an external transceiver; the pins below are the controller's TX/RX to
// that transceiver, NOT the differential pair. CANH/CANL exist only on the
// transceiver's bus side.
//
// GPIO 17/18 chosen because they are the only adjacent free pair left that
// is not a strapping pin, not consumed by the N16R8's octal PSRAM
// (GPIO 33-37), not SPI flash (GPIO 26-32), not UART0 (GPIO 43/44), not
// the DevKitC-1's onboard RGB LED (GPIO 48), and not GPIO 13 — which this
// project already learned is the Arduino-ESP32 default SPI MISO and gets
// clobbered by SPI.begin() during display init (see PIN_WAKE_LED below).
// They sit on ADC2, which is unusable while Wi-Fi is associated anyway, so
// nothing of value is lost by spending them here.
constexpr uint8_t  PIN_CAN_TX      = 17;
constexpr uint8_t  PIN_CAN_RX      = 18;
constexpr uint32_t CAN_BITRATE_BPS = 1000000;  // 1 Mbps — all Jugglebot nodes must agree

// --- Rail / reservoir monitoring ---
// Renamed in spirit from "battery monitoring": the clapboard is now mains-
// adjacent, fed from the robot's shared 12 V harness. The ADC no longer
// watches a discharging LiPo, it watches the flash reservoir cap recovering
// after a fire (and, incidentally, the rail itself — with no current through
// the charge resistor the cap node sits at rail voltage).
//
// IMPORTANT: tap the divider at the CAP node, not at the rail. The cap node
// is what determines whether a flash can actually be delivered; the rail
// tells you nothing about reservoir state.
constexpr uint8_t PIN_VBATT_ADC = 1;

// --- Sync timing ---
// LED_PULSE_MS is the gate-HIGH window for one flash. It must be at least
// one camera frame period, otherwise a camera shooting at a shutter angle
// below 360° can miss the flash entirely: at 24 fps the frame period is
// 41.7 ms but a 180° shutter is only open for 20.8 ms of it, so a pulse
// shorter than the frame period has a real chance of landing in the closed
// window. 50 ms clears 24 fps with margin and is the shortest value that
// does. Do NOT shorten this to make the flash brighter — brightness comes
// from the reservoir cap (see FIRE_RAIL_* below), not from pulse width.
//
// Pre-Phase-11 this was two constants (LED_PULSE_MS = 50 alongside
// SOLENOID_PULSE_MS = 60, the latter being the one actually used as the
// pulse window). With audio sync cut there is one emitter and one window.
constexpr uint32_t LED_PULSE_MS      = 50;

// Firmware safety cap. The hw_timer_t ISR in fire.cpp forces the gates LOW
// after the pulse window regardless of main-loop state; this is the ceiling
// that window may never exceed (static_assert in fire.cpp).
constexpr uint32_t FIRE_MAX_PULSE_MS = 80;

// --- Rail thresholds (Jugglebot 12 V harness) ---
// Divider: 10k top / 2.2k bottom → ratio 2.2/(10+2.2) ≈ 0.1803.
//
// The 3S-LiPo-era divider was 10k/3.3k (ratio 0.2481), which put 12 V at
// 2.98 V on the pin. The S3's ADC at 11 dB attenuation is only well
// calibrated to roughly 2.45 V — beyond that it compresses, so the top of
// the range (exactly where the fire gate reads) was the least trustworthy
// part of the curve. 10k/2.2k puts 12.0 V at 2.16 V and a post-flash 9.5 V
// at 1.71 V, both comfortably linear, with headroom to ~14 V before the
// ADC's useful ceiling. Change the resistors and this constant together.
constexpr float VBATT_DIVIDER_RATIO = 2.2f / (10.0f + 2.2f);

// Absolute floor. Below this the 12 V harness itself is in trouble (blown
// fuse feeding a partial path, a failing buck upstream, a brown-out from
// something else on the shared rail) and firing would be both futile and
// antisocial — the flash pulls from a rail the Jetson is also on.
constexpr uint32_t RAIL_MIN_FIRE_MV = 10500;

// Hard-shutdown floor: log loudly, stop driving anything discretionary.
constexpr uint32_t RAIL_CRITICAL_MV = 9500;

// Reservoir-recovered gate, expressed as a fraction of the observed idle
// rail baseline rather than an absolute value. A fixed threshold would
// either lock out a legitimately-11.5 V supply forever or wave through a
// half-charged cap on a 12.5 V one. See docs/phased-build-plan.md Phase 12.
constexpr float FIRE_CAP_READY_FRACTION = 0.95f;

// --- Wake button + status LED (Phase 8) ---
// Wake button: momentary, button-to-GND, internal pull-up. Pressed = LOW.
// Must be RTC-IO capable for ext0 deep-sleep wake; GPIO 2 satisfies this on
// the S3 and is not a strapping pin. Recommended hardware: 6 mm tactile
// switch with optional external 10k + 100nF RC if bounce is observed.
constexpr uint8_t  PIN_WAKE_BUTTON = 2;

// --- Fire button (Phase 9) ---
// Momentary, button-to-GND, internal pull-up. Pressed = LOW. Drives the
// LED flash via the firmware fire state machine. NOT a deep-
// sleep wake source in v1 — the fire path only arms while the device is
// awake (the wake button is the way back up). GPIO 14 is RTC-IO capable
// (so a future "fire button also wakes" variant is possible without a
// pin move) and is not a strapping pin. Same recommended RC as the wake
// button if bounce is observed beyond firmware debounce.
constexpr uint8_t  PIN_FIRE_BUTTON = 14;

// Minimum gap between consecutive accepted fires — the refractory period.
// Presses arriving inside the cooldown window are silently ignored, not
// queued.
//
// This was originally a UX guess ("1-2 s feels right"). It now has an
// electrical derivation: the flash draws from a reservoir cap, and the cap
// recharges through a series resistor sized so plug-in inrush respects the
// 0.5 A budget on the robot's shared 12 V rail. Recharge to ~98% takes 4·RC.
// With the baseline 10,000 µF / 27 Ω build that is 1.08 s, so 1500 ms clears
// it with margin.
//
// If you change C or R, recompute: MIN_FIRE_GAP_MS >= 4 * R * C, rounded up
// with margin. docs/wiring-guide.md "Phase 6" tabulates the sanctioned
// (C, R, gap) combinations — they move together, and the firmware cannot
// detect a mismatch on its own. The Phase 12 reservoir-voltage gate is the
// backstop that makes a stale constant safe rather than dangerous.
constexpr uint32_t MIN_FIRE_GAP_MS = 1500;
// Status LED: HIGH = device awake, LOW = sleeping or pre-init. GPIO 21 is
// not a strapping pin and isn't claimed by any default peripheral on the
// S3-DevKitC-1 (GPIO 13 was rejected because it's the Arduino-ESP32 default
// SPI MISO — `SPI.begin()` with no args attaches MISO and overrides our
// OUTPUT mode, so the LED would go dark as soon as GxEPD2 inits the bus.
// GPIO 3 was rejected earlier because it's a strapping pin that samples
// ROM-message behaviour at reset.) Drive direct via ~330 Ω to LED to GND,
// ~5 mA.
constexpr uint8_t  PIN_WAKE_LED    = 21;

// Debounce / long-press timing constants live in src/power_state.h so the
// pure state machine compiles into [env:native] without dragging Arduino.h
// in via this header. Pin defines stay here because they're hardware
// configuration; timing thresholds are state-machine logic.
