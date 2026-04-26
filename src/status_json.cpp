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

    out += '}';
    return out;
}
