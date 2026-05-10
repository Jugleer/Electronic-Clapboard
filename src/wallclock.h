#pragma once

// Phase 10: wall-clock anchoring for screensaver wallclock_hybrid mode.
//
// Strategy:
//   - On a wake-button wake, after Wi-Fi associates, kick SNTP via
//     configTime(). SNTP runs in a background task; the firmware does
//     not block on it. is_synced() polls (time(nullptr) > 1.7e9) which
//     is true once SNTP has set the system clock.
//   - The ESP32's RTC clock keeps ticking through deep-sleep timer
//     wakes for as long as the chip is powered, so once the system
//     clock has been set it survives the cycle automatically. No
//     manual NVS anchor needed.
//   - A full power cycle drops the RTC. After re-power, gettimeofday()
//     returns a tiny value (epoch + boot seconds) and is_synced()
//     returns false until the next wake-button wake re-syncs SNTP.
//
// On a timer-wake, Wi-Fi is off and we never call sync_async() — we
// just consult is_synced() / unix_seconds() to decide whether
// wallclock_hybrid runs (synced) or falls back to round_robin
// (unsynced).
//
// Arduino-side; not linked into [env:native].

#include <cstdint>

namespace wallclock {

// Sanity threshold: 1.7e9 ≈ 2023-11-14T22:13:20Z. Anything below this
// is "the system clock has not been set since power-up." Not the
// world's most precise lower bound, but well clear of typical
// RTC-after-cold-boot values.
constexpr uint64_t SANITY_THRESHOLD_S = 1700000000ULL;

// Kick SNTP. Non-blocking. Safe to call after WiFi.status() == WL_CONNECTED.
// Calling before Wi-Fi is up is a no-op (the SNTP query will simply
// time out and the clock stays unset).
void sync_async();

// True iff the system clock has been set to a real wall-clock value
// at least once since power-up.
bool is_synced();

// Current unix time in seconds. Returns 0 when !is_synced(). Surives
// deep-sleep timer wakes; resets on power cycle.
uint64_t unix_seconds();

}  // namespace wallclock
