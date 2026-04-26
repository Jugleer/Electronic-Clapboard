#include "log_ring.h"

#include <algorithm>
#include <cstring>

LogRing::LogRing(size_t capacity)
    : buf_(capacity, 0), cap_(capacity), write_total_(0) {}

void LogRing::push(const char* data, size_t len) {
    if (data == nullptr || len == 0 || cap_ == 0) return;

    // If the caller hands us more bytes than we can hold, only retain the
    // last `cap_` bytes. write_total_ still advances by the full input
    // length so reader cursors see the correct loss.
    if (len > cap_) {
        const size_t skip = len - cap_;
        write_total_ += skip;
        data += skip;
        len  -= skip;
    }

    const size_t head = static_cast<size_t>(write_total_ % cap_);
    const size_t first_chunk = std::min(len, cap_ - head);
    std::memcpy(buf_.data() + head, data, first_chunk);
    if (len > first_chunk) {
        std::memcpy(buf_.data(), data + first_chunk, len - first_chunk);
    }
    write_total_ += len;
}

LogRing::Cursor LogRing::make_cursor() const {
    return write_total_;
}

LogRing::Cursor LogRing::make_replay_cursor() const {
    return (write_total_ > cap_) ? (write_total_ - cap_) : 0;
}

DrainResult LogRing::drain(Cursor& cursor, char* out, size_t max_bytes) {
    DrainResult r{0, 0};
    if (out == nullptr || max_bytes == 0 || cap_ == 0) return r;

    // Cursor lapped: anything older than (write_total_ - cap_) has been
    // overwritten. Snap the cursor forward and report the gap.
    const Cursor oldest_available =
        (write_total_ > cap_) ? (write_total_ - cap_) : 0;
    if (cursor < oldest_available) {
        r.bytes_lost = static_cast<size_t>(oldest_available - cursor);
        cursor = oldest_available;
    }

    const Cursor available = write_total_ - cursor;
    const size_t to_copy   = std::min(static_cast<size_t>(available), max_bytes);
    if (to_copy == 0) return r;

    const size_t start       = static_cast<size_t>(cursor % cap_);
    const size_t first_chunk = std::min(to_copy, cap_ - start);
    std::memcpy(out, buf_.data() + start, first_chunk);
    if (to_copy > first_chunk) {
        std::memcpy(out + first_chunk, buf_.data(), to_copy - first_chunk);
    }
    cursor += to_copy;
    r.bytes_written = to_copy;
    return r;
}
