#pragma once

// Phase 9: physical fire (sync) button + LED + solenoid pulse path.
//
// Owns:
//   - PIN_FIRE_BUTTON GPIO (input + pull-up).
//   - PIN_LED_GATE / PIN_SOLENOID_GATE drive during a pulse.
//   - hw_timer_t hardware-timer watchdog ISR that forces both gates
//     LOW after SOLENOID_MAX_PULSE_MS regardless of main-loop state
//     (CLAUDE.md non-negotiable).
//   - last_fire_at_ms / fires_since_boot accounting for /status.
//
// Awake-only: this module is initialised from setup() and serviced
// from loop(). The wake/sleep path in src/power.cpp does not call
// into this module — when the device is asleep, loop() isn't running,
// so service() can't sample. On wake, setup() re-runs and reset()
// clears state. protocol.md §2.5 documents the cooldown-resets-on-
// wake observable.
//
// The pure debounce + edge-detection logic lives in
// src/power_state.h (reused as ButtonTracker) and the pure fire
// state machine in src/fire_state.h. Hardware concerns (gate drive,
// ADC sampling, hw_timer_t) live here.

#include <cstdint>
#include <optional>

namespace fire {

// Initialise pin modes, register the watchdog hardware timer, and
// reset the fire state machine to Idle. Call from setup() AFTER
// hold_high_current_rails_low() — this module relies on the gates
// already being LOW.
void begin();

// Poll the fire button + ADC and advance the state machine. Call
// every loop tick. On an accepted press, drives PIN_LED_GATE and
// PIN_SOLENOID_GATE HIGH simultaneously and arms the watchdog.
// On pulse-window expiry (checked from loop, not the ISR), drives
// both LOW. The ISR is the safety backstop: if loop() hangs past
// SOLENOID_MAX_PULSE_MS, the timer ISR forces the gates LOW
// independent of any FreeRTOS scheduling.
void service();

// Snapshot accessors for /status. Mirror frame::last_meta()'s shape
// and discipline: std::nullopt → JSON null in the response.
std::optional<uint32_t> last_fire_at_ms();
uint32_t                fires_since_boot();
bool                    is_fire_ready();

}  // namespace fire
