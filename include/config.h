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

// --- Battery monitoring ---
constexpr uint8_t PIN_VBATT_ADC = 1;

// --- USB OTG (fallback wired keyboard) ---
constexpr uint8_t PIN_USB_DM = 19;
constexpr uint8_t PIN_USB_DP = 20;

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

// --- Battery thresholds (3S LiPo, 11.1V nominal) ---
// Divider: 10k top / 3.3k bottom → ratio 3.3/(10+3.3) ≈ 0.2481
constexpr float    VBATT_DIVIDER_RATIO       = 3.3f / (10.0f + 3.3f);
constexpr uint32_t LOW_BATTERY_THRESHOLD_MV  = 10500;  // 3.50 V/cell — refuse sync below this
constexpr uint32_t CRITICAL_BATTERY_MV       = 9900;   // 3.30 V/cell — shut down

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

// Minimum gap between consecutive accepted fires. Presses arriving
// inside the cooldown window are silently ignored — not queued. 1500 ms
// sits in the middle of the user-stated 1–2 s envelope: long enough for
// the operator to clearly intend a second clap, short enough that
// back-to-back takes don't drag.
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
