#pragma once

// Firmware logging API. printf-style; output is teed to:
//   - the USB-CDC `Serial` device (when connected), and
//   - the in-RAM ring buffer that backs the TCP log streamer (port 23).
//
// Calls are non-blocking: the ring drops the oldest bytes if a network
// client falls behind. Safe to call from any FreeRTOS task; an internal
// portMUX serialises pushes.
//
// Each call appends a single line. A '\n' is added if the format string
// doesn't already end with one, so call sites stay tidy.

#include <cstddef>
#include <cstdint>

void clap_log_begin();   // call once from setup() after Serial.begin().

void clap_log(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

// Drain log bytes for the TCP server. Returns bytes copied into out.
// `cursor` is advanced; pass an out_lost pointer to capture the lapped
// byte count from the most recent drain. Both parameters are optional.
struct ClapLogDrain {
    uint64_t cursor;       // opaque; initialise via clap_log_make_cursor()
    uint32_t bytes_lost;   // last drain's loss count
};

ClapLogDrain clap_log_make_cursor(bool replay_history);
size_t       clap_log_drain(ClapLogDrain& state, char* out, size_t max);
