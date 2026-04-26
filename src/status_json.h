#pragma once

// Pure C++ /status JSON builder.
//
// Lives outside Arduino-land so it links into both the firmware target
// and the host-side Unity test binary. Contract is locked in
// docs/protocol.md §2.2 — in particular, the four `last_frame_*` fields
// must serialise as JSON `null` (not `0`, not absent) before any frame
// has been received.

#include <cstdint>
#include <optional>
#include <string>

struct LastFrameMeta {
    uint32_t at_ms;
    uint32_t bytes;
    uint32_t render_ms;
    bool     full_refresh;
};

struct StatusInputs {
    std::string firmware_version;
    uint32_t    uptime_ms;
    uint32_t    free_heap;
    uint32_t    psram_free;
    std::optional<LastFrameMeta> last_frame;
};

// Returns a single-line UTF-8 JSON object matching protocol.md §2.2.
std::string build_status_json(const StatusInputs& in);
