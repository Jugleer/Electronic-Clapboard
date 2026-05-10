#include "screensaver_manifest.h"

#include <string>

namespace {

void append_uint32(std::string& out, uint32_t v) { out += std::to_string(v); }

void append_uint64(std::string& out, uint64_t v) {
    // std::to_string(uint64_t) is well-defined; spelled out explicitly so
    // the host build doesn't pick the long-double overload by accident.
    out += std::to_string(static_cast<unsigned long long>(v));
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

const char* picker_mode_str(screensaver_state::PickerMode m) {
    switch (m) {
        case screensaver_state::PickerMode::RoundRobin:      return "round_robin";
        case screensaver_state::PickerMode::WallclockHybrid: return "wallclock_hybrid";
    }
    return "round_robin";
}

}  // namespace

using screensaver_manifest::ManifestInputs;
using screensaver_manifest::SlotInfo;

std::string build_manifest_json(const ManifestInputs& in) {
    std::string out;
    out.reserve(512);
    out += '{';

    append_key(out, "ok", /*first=*/true);
    out += "true";

    append_key(out, "enabled", false);
    out += (in.enabled ? "true" : "false");

    append_key(out, "cycle_interval_s", false);
    append_uint32(out, in.cycle_interval_s);

    append_key(out, "min_cycle_interval_s", false);
    append_uint32(out, in.min_cycle_interval_s);

    append_key(out, "max_cycle_interval_s", false);
    append_uint32(out, in.max_cycle_interval_s);

    append_key(out, "max_slots", false);
    append_uint32(out, in.max_slots);

    append_key(out, "picker_mode", false);
    out += '"';
    out += picker_mode_str(in.picker_mode);
    out += '"';

    append_key(out, "picker_mode_actual", false);
    out += '"';
    out += picker_mode_str(in.picker_mode_actual);
    out += '"';

    append_key(out, "rtc_synced", false);
    out += (in.rtc_synced ? "true" : "false");

    // current_slot, last_tick_ms, next_tick_ms: explicit JSON null until
    // the first tick / when no slots populated. Same null-vs-value
    // discipline as last_frame_* in /status.
    append_key(out, "current_slot", false);
    if (in.current_slot.has_value()) {
        append_uint32(out, static_cast<uint32_t>(*in.current_slot));
    } else {
        out += "null";
    }

    append_key(out, "last_tick_ms", false);
    if (in.last_tick_ms.has_value()) {
        append_uint64(out, *in.last_tick_ms);
    } else {
        out += "null";
    }

    append_key(out, "next_tick_ms", false);
    if (in.next_tick_ms.has_value()) {
        append_uint64(out, *in.next_tick_ms);
    } else {
        out += "null";
    }

    append_key(out, "slots", false);
    out += '[';
    for (size_t i = 0; i < in.slots.size(); i++) {
        if (i != 0) out += ',';
        const SlotInfo& s = in.slots[i];
        out += '{';
        append_key(out, "slot",          true);
        append_uint32(out, static_cast<uint32_t>(s.slot));
        append_key(out, "name",          false);
        append_quoted(out, s.name);
        append_key(out, "bytes",         false);
        append_uint32(out, s.bytes);
        append_key(out, "updated_at_ms", false);
        append_uint32(out, s.updated_at_ms);
        out += '}';
    }
    out += ']';

    out += '}';
    return out;
}
