#pragma once

// Bounded byte-oriented ring buffer for runtime log streaming.
//
// Drop-oldest policy: writers never block. If a reader's cursor falls
// behind the write head by more than `capacity` bytes, the next drain()
// returns the newest `capacity` bytes available and reports how many bytes
// were missed via DrainResult::bytes_lost. The reader can surface that to
// the network client so a connected tail knows it lost data.
//
// Pure C++, no Arduino, no FreeRTOS — host-testable and lock-free at the
// container level. The firmware-side glue is responsible for its own
// synchronisation (a portMUX critical section around push/drain) since
// the ESP32 calls push() from multiple FreeRTOS tasks.

#include <cstddef>
#include <cstdint>
#include <vector>

struct DrainResult {
    size_t bytes_written;  // bytes copied into the caller's buffer
    size_t bytes_lost;     // bytes dropped because the cursor got lapped
};

class LogRing {
public:
    using Cursor = uint64_t;  // monotonic write index, never wraps

    explicit LogRing(size_t capacity);

    // Append `len` bytes. If len > capacity the oldest part of the input
    // is also discarded (only the trailing `capacity` bytes are stored).
    void push(const char* data, size_t len);

    // Cursor pointing at the current write head. A reader created here
    // sees only future writes (no replay of buffered history).
    Cursor make_cursor() const;

    // Cursor pointing at the oldest byte currently held in the ring.
    // A reader created here gets up to `capacity` bytes of replay before
    // catching up to live writes. Reports zero bytes_lost on first drain.
    Cursor make_replay_cursor() const;

    // Copy up to `max_bytes` bytes from `cursor` into `out`, advancing the
    // cursor. If the cursor was lapped by writers, jumps it to the oldest
    // available byte and reports the gap as bytes_lost.
    DrainResult drain(Cursor& cursor, char* out, size_t max_bytes);

    size_t capacity() const { return cap_; }

private:
    std::vector<char> buf_;
    size_t            cap_;
    Cursor            write_total_;  // total bytes ever pushed
};
