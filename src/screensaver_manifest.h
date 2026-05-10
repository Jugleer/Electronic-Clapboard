#pragma once

// Pure /screensaver/manifest JSON serialiser.
//
// Lives outside Arduino-land so it links into both the firmware target
// and the host-side Unity test binary. Field names + null discipline
// locked in protocol.md §2.6.

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "screensaver_state.h"  // for PickerMode

namespace screensaver_manifest {

struct SlotInfo {
    uint8_t     slot;          // 0..49
    std::string name;          // 0..32 chars
    uint32_t    bytes;         // expected 48000 in v1
    uint32_t    updated_at_ms; // device millis() when last written
};

struct ManifestInputs {
    bool                          enabled              = false;
    uint32_t                      cycle_interval_s     = 300;
    uint32_t                      min_cycle_interval_s = 60;
    uint32_t                      max_cycle_interval_s = 604800;
    uint32_t                      max_slots            = 50;
    screensaver_state::PickerMode picker_mode          = screensaver_state::PickerMode::RoundRobin;
    screensaver_state::PickerMode picker_mode_actual   = screensaver_state::PickerMode::RoundRobin;
    bool                          rtc_synced           = false;
    std::optional<uint8_t>        current_slot;
    std::optional<uint64_t>       last_tick_ms;
    std::optional<uint64_t>       next_tick_ms;
    std::vector<SlotInfo>         slots;  // caller emits in ascending slot order
};

}  // namespace screensaver_manifest

// Returns a single-line UTF-8 JSON object matching protocol.md §2.6.
std::string build_manifest_json(const screensaver_manifest::ManifestInputs& in);
