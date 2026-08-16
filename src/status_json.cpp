#include "status_json.h"

#include <string>

namespace {

void append_uint(std::string& out, uint32_t v) {
    out += std::to_string(v);
}

void append_quoted(std::string& out, const std::string& s) {
    out += '"';
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                out += c;
                break;
        }
    }
    out += '"';
}

void append_key(std::string& out, const char* key, bool first) {
    if (!first) out += ',';
    out += '"';
    out += key;
    out += "\":";
}

}  // namespace

std::string build_status_json(const StatusInputs& in) {
    std::string out;
    out.reserve(256);
    out += '{';

    append_key(out, "ok", /*first=*/true);
    out += "true";

    append_key(out, "firmware_version", false);
    append_quoted(out, in.firmware_version);

    append_key(out, "uptime_ms", false);
    append_uint(out, in.uptime_ms);

    append_key(out, "free_heap", false);
    append_uint(out, in.free_heap);

    append_key(out, "psram_free", false);
    append_uint(out, in.psram_free);

    // last_frame_*: null until the first /frame POST has been processed.
    // protocol.md §2.2: explicit JSON null distinguishes "never received"
    // from "received and these were the values."
    if (in.last_frame.has_value()) {
        const LastFrameMeta& lf = *in.last_frame;

        append_key(out, "last_frame_at", false);
        append_uint(out, lf.at_ms);

        append_key(out, "last_frame_bytes", false);
        append_uint(out, lf.bytes);

        append_key(out, "last_frame_render_ms", false);
        append_uint(out, lf.render_ms);

        append_key(out, "last_full_refresh", false);
        out += (lf.full_refresh ? "true" : "false");
    } else {
        append_key(out, "last_frame_at", false);
        out += "null";

        append_key(out, "last_frame_bytes", false);
        out += "null";

        append_key(out, "last_frame_render_ms", false);
        out += "null";

        append_key(out, "last_full_refresh", false);
        out += "null";
    }

    // Phase 9 fire fields. last_fire_at_ms uses the same null-vs-value
    // discipline as last_frame_*: explicit JSON null distinguishes
    // "never fired this session" from "fired with this timestamp".
    if (in.last_fire_at_ms.has_value()) {
        append_key(out, "last_fire_at_ms", false);
        append_uint(out, *in.last_fire_at_ms);
    } else {
        append_key(out, "last_fire_at_ms", false);
        out += "null";
    }

    append_key(out, "fires_since_boot", false);
    append_uint(out, in.fires_since_boot);

    append_key(out, "fire_ready", false);
    out += (in.fire_ready ? "true" : "false");

    // Phase 13 CAN block. Nested rather than flat because it is a coherent
    // subsystem snapshot and a client either cares about all of it or none.
    append_key(out, "can", false);
    if (in.can.has_value()) {
        const CanStatus& c = *in.can;
        out += '{';
        append_key(out, "up", /*first=*/true);
        out += "true";

        append_key(out, "bus_off", false);
        out += (c.bus_off ? "true" : "false");

        append_key(out, "rx_frames", false);
        append_uint(out, c.rx_frames);

        append_key(out, "rx_dropped", false);
        append_uint(out, c.rx_dropped);

        append_key(out, "tx_frames", false);
        append_uint(out, c.tx_frames);

        append_key(out, "tx_errors", false);
        append_uint(out, c.tx_errors);

        append_key(out, "bus_off_events", false);
        append_uint(out, c.bus_off_events);

        append_key(out, "time_synced", false);
        out += (c.time_synced ? "true" : "false");

        append_key(out, "link_seen", false);
        out += (c.link_seen ? "true" : "false");

        append_key(out, "ros2_up", false);
        out += (c.ros2_up ? "true" : "false");

        // UINT32_MAX is the "never" sentinel. Serialise it as null so a
        // client plotting these can't graph 4.29e9 as a real age.
        append_key(out, "ms_since_link", false);
        if (c.ms_since_link == UINT32_MAX) out += "null";
        else append_uint(out, c.ms_since_link);

        append_key(out, "ms_since_sync", false);
        if (c.ms_since_sync == UINT32_MAX) out += "null";
        else append_uint(out, c.ms_since_sync);

        append_key(out, "show_scene", false);
        out += (c.show_scene ? "true" : "false");

        out += '}';
    } else {
        out += "null";
    }

    out += '}';
    return out;
}
