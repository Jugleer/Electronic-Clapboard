#pragma once

// Phase 10: screensaver slate-set storage + cycle driver.
//
// Owns:
//   - LittleFS partition `slate_data` mounted at /screensaver/.
//   - Atomic slot writes (slot_<n>.bin.tmp → rename) and atomic
//     manifest rewrites (manifest.json.tmp → rename).
//   - Boot-time reconciliation of manifest vs disk.
//   - NVS persistence of the round-robin counter and current config.
//   - HTTP routes for /screensaver/{manifest,frame,rename,config}.
//   - Timer-wake tick: pick next slot, render full-refresh, re-arm
//     RTC timer, drop back to deep sleep.
//
// Pure state-machine logic lives in src/screensaver_state.h
// (header-only, host-testable). JSON serialisation lives in
// src/screensaver_manifest.{h,cpp} (linked into both targets).
// This module is the Arduino-side glue and HTTP surface.

#include <cstdint>

class AsyncWebServer;

namespace screensaver {

// One-time setup. On a wake-button / cold-boot wake, mounts LittleFS,
// reconciles manifest vs disk, loads NVS config + counter, and pauses
// the cycle for the awake session (so editor writes don't race a
// timer-wake). Call AFTER hold_high_current_rails_low() and BEFORE
// any HTTP routes that read the manifest.
void begin();

// Wires the four /screensaver/* routes onto the server. Call from
// net.cpp's start_http_server() while the server is still building.
void register_routes(AsyncWebServer& server);

// Timer-wake entry point. Skips Wi-Fi / HTTP entirely: powers up the
// EPD, picks the next slot, runs a full refresh (synchronous; no
// deferred lockin since the AsyncTCP task isn't running), re-arms the
// RTC timer, drops MOSFET gates, deep-sleeps. Does not return.
[[noreturn]] void tick_and_resleep();

// True iff the cycle is enabled AND there is at least one occupied
// slot. Used by main_net.cpp on a wake-button wake to decide whether
// the timer should be re-armed when the user long-presses to sleep.
bool should_arm_timer();

// Current cycle interval in seconds. Read after begin() has loaded
// the NVS-persisted config; used by main_net.cpp when arming the
// next timer-wake on long-press.
uint32_t cycle_interval_s();

// Arm the RTC timer for the next tick and enter deep sleep. Called
// from power::enter_sleep() *instead of* the existing button-only
// sleep path when should_arm_timer() returns true. Same MOSFET-gate-
// LOW + EPD-power-off sequence as power.cpp's plain ext0 sleep, plus
// esp_sleep_enable_timer_wakeup(cycle_interval_s * 1e6 µs).
[[noreturn]] void enter_timer_sleep();

}  // namespace screensaver
