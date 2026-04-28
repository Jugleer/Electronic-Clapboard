#pragma once

// Phase 8: wake-button + deep-sleep power management.
//
// Owns:
//   - Wake-button GPIO (input + pull-up) and status-LED GPIO (output).
//   - Boot-time wake-reason classification (cold / button / timer).
//   - Loop-tick button polling, debounced via power_state::ButtonTracker.
//   - Deep-sleep entry: power-gate the EPD, drop MOSFET gates LOW
//     (CLAUDE.md non-negotiable), arm ext0 wake on PIN_WAKE_BUTTON LOW.
//
// Wake from deep-sleep is hardware-driven; firmware re-runs setup() on
// every wake. The wake-reason accessor lets the boot path skip Wi-Fi /
// splash on a timer-wake (Phase 9 hook — Phase 8 never enables timer
// wake, so the Timer branch here is unreachable until Phase 9 lands).
//
// Arduino-side; not linked into [env:native]. The pure debounce / long-
// press logic lives in power_state.h and is tested separately.

#include <cstdint>

namespace power {

enum class WakeReason {
    ColdBoot,  // power-on reset, brown-out reset, or any non-sleep wake
    Button,    // ext0: PIN_WAKE_BUTTON went LOW
    Timer,     // RTC timer (reserved for Phase 9 screensaver tick)
};

// Read esp_sleep_get_wakeup_cause() once at boot, configure the wake-LED
// + button GPIOs, and turn the LED on (we are now awake). Call from
// setup() AFTER hold_high_current_rails_low() but BEFORE display::begin()
// or net::begin() — wake-reason informs whether those should run at all
// once Phase 9 lands.
void begin();

// What woke us this boot. Stable for the lifetime of this awake session.
WakeReason wake_reason();
const char* wake_reason_name();

// Poll the wake button. Call every loop tick (cheap when no edge).
// On a long-press (>= power_state::LONG_PRESS_MS), this calls
// enter_sleep() directly — the function does not return.
void service();

// Drop into deep sleep. Sequence: blink LED, re-assert MOSFET gates LOW
// (defensive), display::power_off() to drop the panel rail, configure
// ext0 wake, esp_deep_sleep_start(). Does not return.
[[noreturn]] void enter_sleep();

}  // namespace power
