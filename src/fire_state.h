#pragma once

// Pure state machine for the fire (sync) button. Header-only so it
// links into [env:native] without Arduino, mirroring lockin_state.h
// and power_state.h.
//
// Inputs:
//   - debounced button-edge detection (the Arduino-side glue feeds us
//     `pressed` via a power_state::ButtonTracker — we only act on the
//     debounced rising edge; the tracker itself is reused, not
//     re-implemented).
//   - a low-battery flag the caller refreshes around each sample().
//
// Outputs:
//   - Action::Fire is returned exactly once per accepted press. The
//     caller is the authoritative gate-driver — it sees Fire and is
//     responsible for raising the LED + solenoid gates simultaneously,
//     scheduling the watchdog, and clearing them after pulse_ms.
//   - the same press during cooldown / low-battery returns Action::None
//     (silently ignored — not queued).
//
// The state diagram is intentionally tiny:
//
//     Idle ── debounced press ──► Firing
//        ▲                          │
//        │                  pulse_ms elapsed
//        │                          ▼
//        │                       CoolDown
//        │                          │
//        │            MIN_FIRE_GAP_MS elapsed since fire
//        └──────────────────────────┘
//
// The Firing state exists so /status can surface "fire in flight"
// distinct from "in cooldown after a fire" if we ever want to. The
// caller drives the actual gate timing; the state machine just tracks
// when it's safe to accept the next press.

#include <cstdint>

namespace fire_state {

enum class State {
    Idle,      // ready; next press fires
    Firing,    // gates are HIGH (caller is mid-pulse)
    CoolDown,  // pulse done, waiting for MIN_FIRE_GAP_MS to elapse
};

enum class Action {
    None,
    Fire,  // returned exactly once per accepted press
};

class StateMachine {
public:
    State    state()              const { return state_; }
    uint32_t fires_since_boot()   const { return fires_since_boot_; }
    bool     has_fired()          const { return fires_since_boot_ > 0; }
    uint32_t last_fire_at_ms()    const { return last_fire_at_ms_; }

    // Feed one sample. `debounced_pressed` is the ButtonTracker's
    // debounced state, NOT the raw GPIO. `low_battery` is true iff the
    // most recent ADC sample was below threshold. Returns Action::Fire
    // exactly once, on the rising edge of debounced_pressed, when:
    //   - state is Idle (not Firing, not CoolDown)
    //   - low_battery is false
    Action sample(uint32_t now_ms, bool debounced_pressed, bool low_battery,
                  uint32_t pulse_ms, uint32_t min_gap_ms) {
        // Rising-edge detection on the debounced signal. A held button
        // must not re-fire — only the transition counts.
        const bool rising = debounced_pressed && !prev_debounced_;
        prev_debounced_  = debounced_pressed;

        // Time-driven transitions (run before edge handling so a press
        // arriving on the same tick as the cooldown expiry is accepted).
        if (state_ == State::Firing) {
            // Caller pulses for pulse_ms. We track the same window so
            // /status's fire_ready stays correct without the caller
            // having to call back in. The caller's own watchdog is the
            // load-bearing gate driver — this transition is purely
            // bookkeeping.
            if ((now_ms - last_fire_at_ms_) >= pulse_ms) {
                state_ = State::CoolDown;
            }
        }
        if (state_ == State::CoolDown) {
            if ((now_ms - last_fire_at_ms_) >= min_gap_ms) {
                state_ = State::Idle;
            }
        }

        if (!rising) return Action::None;
        if (low_battery) {
            // Silently ignored. fires_since_boot does not tick;
            // last_fire_at_ms is unchanged. The caller's /status
            // builder reads fire_ready from is_fire_ready(), which
            // factors in low_battery.
            return Action::None;
        }
        if (state_ != State::Idle) {
            // Press during Firing or CoolDown — silently ignored.
            return Action::None;
        }

        // Accept the press.
        state_              = State::Firing;
        last_fire_at_ms_    = now_ms;
        ++fires_since_boot_;
        return Action::Fire;
    }

    // True when a press right now would be accepted. Mirrors the
    // gating in sample(): Idle AND not low_battery. Used by the
    // /status JSON builder so clients can render "fire ready" /
    // "cooling down" / "fire blocked".
    bool is_fire_ready(bool low_battery) const {
        return state_ == State::Idle && !low_battery;
    }

    // Reset to Idle. Called from begin() (after wake / cold boot) so
    // we don't carry stale state from before. Cooldown does NOT
    // survive deep-sleep — protocol.md §2.5 documents this.
    void reset() {
        state_              = State::Idle;
        prev_debounced_     = false;
        last_fire_at_ms_    = 0;
        fires_since_boot_   = 0;
    }

private:
    State    state_              = State::Idle;
    bool     prev_debounced_     = false;
    uint32_t last_fire_at_ms_    = 0;  // millis() of most recent accepted fire
    uint32_t fires_since_boot_   = 0;
};

}  // namespace fire_state
