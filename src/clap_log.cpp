#include "clap_log.h"

#include <Arduino.h>
#include <cstdarg>
#include <cstdio>
#include <cstring>

#include "log_ring.h"

namespace {

// 8 KB ring sized to comfortably hold ~2 minutes of the project's typical
// log cadence (a few lines per second during connect / refresh activity)
// and keep AsyncTCP send-buffer pressure modest.
constexpr size_t LOG_RING_CAPACITY = 8 * 1024;

LogRing*           ring          = nullptr;
portMUX_TYPE       ring_mux      = portMUX_INITIALIZER_UNLOCKED;
bool               began         = false;

}  // namespace

void clap_log_begin() {
    if (began) return;
    static LogRing instance(LOG_RING_CAPACITY);
    ring  = &instance;
    began = true;
}

void clap_log(const char* fmt, ...) {
    char    line[256];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(line, sizeof(line), fmt, ap);
    va_end(ap);
    if (n < 0) return;
    size_t len = (n >= static_cast<int>(sizeof(line))) ? sizeof(line) - 1
                                                       : static_cast<size_t>(n);

    // Ensure the line is newline-terminated. Cheaper than asking every call
    // site to remember.
    if (len == 0 || line[len - 1] != '\n') {
        if (len < sizeof(line) - 1) {
            line[len++] = '\n';
            line[len]   = '\0';
        } else {
            line[sizeof(line) - 2] = '\n';
            line[sizeof(line) - 1] = '\0';
            len = sizeof(line) - 1;
        }
    }

    // Tee to USB serial. Cheap when the host isn't reading; the ESP32-S3
    // USB CDC drops bytes silently rather than blocking.
    Serial.write(reinterpret_cast<const uint8_t*>(line), len);

    // Tee to the ring under a critical section so concurrent log calls
    // from different tasks (loopTask, AsyncTCP task) don't tear bytes.
    if (ring != nullptr) {
        portENTER_CRITICAL(&ring_mux);
        ring->push(line, len);
        portEXIT_CRITICAL(&ring_mux);
    }
}

ClapLogDrain clap_log_make_cursor(bool replay_history) {
    ClapLogDrain s{};
    if (ring == nullptr) return s;
    portENTER_CRITICAL(&ring_mux);
    s.cursor = replay_history ? ring->make_replay_cursor()
                              : ring->make_cursor();
    portEXIT_CRITICAL(&ring_mux);
    return s;
}

size_t clap_log_drain(ClapLogDrain& state, char* out, size_t max) {
    if (ring == nullptr || out == nullptr || max == 0) return 0;
    LogRing::Cursor cur = state.cursor;
    portENTER_CRITICAL(&ring_mux);
    DrainResult r = ring->drain(cur, out, max);
    portEXIT_CRITICAL(&ring_mux);
    state.cursor     = cur;
    state.bytes_lost = static_cast<uint32_t>(r.bytes_lost);
    return r.bytes_written;
}
