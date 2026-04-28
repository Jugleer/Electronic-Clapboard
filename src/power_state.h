#pragma once

// Pure state machine for the wake-button. Extracted from power.cpp so it
// can be linked into [env:native] and unit-tested without Arduino.
//
// Gesture model (Phase 8 default — see CLAUDE.md / phased-build-plan.md):
//   - Button is a momentary switch, button-to-GND, internal pull-up.
//     `raw_pressed = (digitalRead == LOW)`.
//   - While AWAKE, a held press of >= LONG_PRESS_MS triggers sleep entry.
//     A short tap does nothing — chosen over single-press toggle so an
//     accidental bump can't put the device to sleep mid-take.
//   - While ASLEEP, the wake itself is hardware-driven (ext0 wakeup); the
//     state machine isn't running. On boot we read esp_sleep_get_wakeup_cause()
//     to distinguish "user pressed button" from "cold boot" / "timer wake".
//
// Debounce: simple time-based — a raw level only promotes to debounced
// state once it has been stable for BUTTON_DEBOUNCE_MS. This is robust to
// hardware bounce without needing the external RC. The RC is still
// recommended (tightens wake from deep-sleep, where firmware debounce
// can't help) but firmware-only operation works.

#include <cstdint>

namespace power_state {

// Timing thresholds. These are state-machine logic, not pin assignments,
// so they live here rather than in config.h — keeps this header
// freestanding (no Arduino.h dependency) for the [env:native] build.
constexpr uint32_t BUTTON_DEBOUNCE_MS = 30;
constexpr uint32_t LONG_PRESS_MS      = 1000;

class ButtonTracker {
public:
    enum class Event {
        None,
        LongPress,  // emitted exactly once per hold past LONG_PRESS_MS
    };

    // Feed one sample. `now_ms` is the current millisecond clock,
    // `raw_pressed` is true when the GPIO reads LOW (button down).
    Event sample(uint32_t now_ms, bool raw_pressed) {
        // Track raw-edge transitions and reset the dwell timer.
        if (raw_pressed != raw_) {
            raw_                = raw_pressed;
            last_raw_change_ms_ = now_ms;
        }

        // Promote raw → debounced once the dwell threshold has elapsed.
        if (raw_ != debounced_) {
            const uint32_t dwell = now_ms - last_raw_change_ms_;
            if (dwell >= BUTTON_DEBOUNCE_MS) {
                debounced_ = raw_;
                if (debounced_) {
                    pressed_since_ms_   = now_ms;
                    long_press_emitted_ = false;
                }
            }
        }

        // Long-press detection — fires once per uninterrupted hold.
        if (debounced_ && !long_press_emitted_) {
            const uint32_t held = now_ms - pressed_since_ms_;
            if (held >= LONG_PRESS_MS) {
                long_press_emitted_ = true;
                return Event::LongPress;
            }
        }
        return Event::None;
    }

    // Accessors for tests / diagnostics.
    bool     debounced_pressed() const { return debounced_; }
    bool     raw_pressed()       const { return raw_; }
    bool     long_press_armed()  const { return debounced_ && !long_press_emitted_; }
    uint32_t pressed_since_ms()  const { return pressed_since_ms_; }

private:
    bool     raw_                = false;
    bool     debounced_          = false;
    bool     long_press_emitted_ = false;
    uint32_t last_raw_change_ms_ = 0;
    uint32_t pressed_since_ms_   = 0;
};

}  // namespace power_state
