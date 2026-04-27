#pragma once

// Pure state machine for the deferred-lockin pass that follows a
// `?full=1` /frame request. Extracted from frame.cpp so it can be
// linked into [env:native] and unit-tested without Arduino / GxEPD2.
//
// Sequence:
//   1. /frame ?full=1 arrives. The handler runs the synchronous
//      all-white pass and calls schedule(now, white_ms). g_busy stays
//      true (the panel still belongs to this request).
//   2. main loop() polls poll(now). When at least SETTLE_MS has
//      elapsed since schedule, poll() returns Action::RunLockin and
//      transitions the state. The loop runs the partial-content pass,
//      then calls finalize(partial_ms). g_busy clears.
//   3. /status reads combined_render_ms() to surface the actual time
//      to the editor.
//
// State invariants:
//   - schedule() is the only entry; finalize() is the only exit
//   - poll() is idempotent: calling it without a pending lockin is a
//     no-op
//   - the SETTLE_MS gate exists so the panel's deep-refresh post-cycle
//     can complete and AsyncTCP can flush response retransmits before
//     another long SPI burst starts

#include <cstdint>

namespace lockin {

// Settle window between the synchronous full-white pass and the
// deferred partial-content pass. 150 ms covers the 7.5" V2 panel's
// post-cycle plus a margin for TCP retransmits.
constexpr uint32_t SETTLE_MS = 150;

enum class State {
    Idle,      // no lockin in flight
    Pending,   // schedule() called, waiting for SETTLE_MS to elapse
};

enum class Action {
    Wait,        // not yet time to run; poll again later
    RunLockin,   // run the partial-content pass now; call finalize() after
};

class StateMachine {
public:
    State state() const { return state_; }

    // Called by the synchronous handler after the full-white pass
    // completes. `white_ms` is the time the all-white pass took.
    void schedule(uint32_t now_ms, uint32_t white_ms) {
        state_                = State::Pending;
        scheduled_at_ms_      = now_ms;
        white_ms_             = white_ms;
        last_partial_ms_      = 0;
    }

    // Called by loop() each tick. Returns RunLockin only when state is
    // Pending and SETTLE_MS has elapsed; the caller is responsible for
    // running the actual partial pass and then calling finalize().
    Action poll(uint32_t now_ms) const {
        if (state_ != State::Pending) return Action::Wait;
        const uint32_t since = now_ms - scheduled_at_ms_;
        if (since < SETTLE_MS) return Action::Wait;
        return Action::RunLockin;
    }

    // Called after the partial-content pass returns. Transitions back
    // to Idle and records timing so combined_render_ms() can report
    // the user-visible total.
    void finalize(uint32_t partial_ms) {
        last_partial_ms_ = partial_ms;
        state_           = State::Idle;
    }

    // Combined render time: white pass + partial pass. Valid only
    // after finalize(); returns 0 in any other state.
    uint32_t combined_render_ms() const {
        return state_ == State::Idle ? (white_ms_ + last_partial_ms_) : 0;
    }

    // Accessors for tests / diagnostics.
    uint32_t white_ms() const { return white_ms_; }
    uint32_t last_partial_ms() const { return last_partial_ms_; }
    uint32_t scheduled_at_ms() const { return scheduled_at_ms_; }

private:
    State    state_            = State::Idle;
    uint32_t scheduled_at_ms_  = 0;
    uint32_t white_ms_         = 0;
    uint32_t last_partial_ms_  = 0;
};

}  // namespace lockin
