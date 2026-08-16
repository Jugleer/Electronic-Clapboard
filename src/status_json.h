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

// Phase 13 CAN link health. Mirrors can_link::Stats but is declared here so
// status_json.cpp stays Arduino-free and linkable into [env:native] — the
// caller in net.cpp does the (trivial) copy across.
struct CanStatus {
    bool     bus_off;
    uint32_t rx_frames;
    uint32_t rx_dropped;
    uint32_t tx_frames;
    uint32_t tx_errors;
    uint32_t bus_off_events;
    bool     time_synced;
    bool     link_seen;
    bool     ros2_up;
    // UINT32_MAX means "never seen"; serialised as JSON null so a client
    // can't mistake a sentinel for a real age.
    uint32_t ms_since_link;
    uint32_t ms_since_sync;
    bool     show_scene;   // resolved §8.5 mode
};

struct StatusInputs {
    std::string firmware_version;
    uint32_t    uptime_ms;
    uint32_t    free_heap;
    uint32_t    psram_free;
    std::optional<LastFrameMeta> last_frame;

    // Phase 9 fire fields (protocol.md §2.2 "Fire fields").
    // last_fire_at_ms: std::nullopt → JSON null (no fires this awake
    //   session, mirroring the last_frame_* discipline).
    // fires_since_boot: monotonic counter; rejected presses don't tick.
    // fire_ready: false during cooldown OR low battery.
    std::optional<uint32_t> last_fire_at_ms;
    uint32_t                fires_since_boot = 0;
    bool                    fire_ready       = true;

    // Phase 13 CAN fields, emitted as a nested "can" object. std::nullopt
    // means the TWAI driver never came up (or this build has no CAN), and
    // serialises as JSON null — same discipline as last_frame_*, so a client
    // can distinguish "no CAN on this device" from "CAN up but idle".
    std::optional<CanStatus> can;
};

// Returns a single-line UTF-8 JSON object matching protocol.md §2.2.
std::string build_status_json(const StatusInputs& in);
