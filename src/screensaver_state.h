#pragma once

// Pure state machine for the screensaver cycle. Header-only so it
// links into [env:native] without Arduino, mirroring lockin_state.h /
// power_state.h / fire_state.h.
//
// What this owns:
//   - which slot the next timer-wake should render (current_slot)
//   - the round-robin NVS counter (pure number; persistence is the
//     caller's job)
//   - picker-mode resolution: configured vs running
//     (`picker_mode_actual` falls back to RoundRobin when WallclockHybrid
//      is configured but rtc_synced=false)
//   - enabled gating: enable+empty-slots silently force-disables
//   - cycle-interval bounds validation (60 s .. 7 d)
//   - tick scheduling timestamps in uint64 ms (sidesteps uint32 wrap)
//   - pause/resume across awake sessions (the editor session pauses
//     the cycle so it can write to slots without racing)
//
// What this does NOT own:
//   - LittleFS I/O, NVS persistence, RTC arming, SNTP — see
//     src/screensaver.cpp / src/wallclock.cpp
//   - JSON serialisation of the manifest — see src/screensaver_manifest.{h,cpp}

#include <cstdint>
#include <optional>

namespace screensaver_state {

// Bounds locked in protocol.md §2.6. Header-only so tests and firmware
// agree on the same numbers without dragging Arduino in via config.h.
constexpr uint32_t MIN_CYCLE_INTERVAL_S = 60;
constexpr uint32_t MAX_CYCLE_INTERVAL_S = 604800;     // 7 days
constexpr uint32_t DEFAULT_INTERVAL_S   = 300;        // 5 minutes
constexpr uint8_t  MAX_SLOTS            = 50;         // slot indices 0..49

enum class PickerMode {
    RoundRobin,
    WallclockHybrid,
};

enum class ConfigVerdict {
    Ok,
    BadInterval,
    BadPickerMode,  // surfaced by the route layer; not produced here
};

// Compact occupied-slot set: a 50-bit bitmap stored as a uint64. Bit N
// set iff slot N is occupied. Iteration is in ascending slot order so
// round-robin behaviour is deterministic.
class OccupiedSlots {
public:
    OccupiedSlots() = default;

    void clear() { mask_ = 0; }

    void add(uint8_t slot) {
        if (slot < MAX_SLOTS) mask_ |= (uint64_t{1} << slot);
    }

    void remove(uint8_t slot) {
        if (slot < MAX_SLOTS) mask_ &= ~(uint64_t{1} << slot);
    }

    bool contains(uint8_t slot) const {
        if (slot >= MAX_SLOTS) return false;
        return (mask_ >> slot) & 0x1;
    }

    uint8_t count() const {
        uint8_t n = 0;
        uint64_t m = mask_;
        while (m) { n += static_cast<uint8_t>(m & 0x1); m >>= 1; }
        return n;
    }

    bool empty() const { return mask_ == 0; }

    // Returns the slot at the given position (0-indexed) within the
    // occupied set, or nullopt if `index_within_occupied` is out of
    // range. O(50) — fine for this scale; `ntz`-based versions exist
    // but the simple loop keeps the host-test trace readable.
    std::optional<uint8_t> nth(uint8_t index_within_occupied) const {
        uint8_t seen = 0;
        for (uint8_t s = 0; s < MAX_SLOTS; s++) {
            if ((mask_ >> s) & 0x1) {
                if (seen == index_within_occupied) return s;
                seen++;
            }
        }
        return std::nullopt;
    }

    uint64_t raw() const { return mask_; }

private:
    uint64_t mask_ = 0;
};

struct SchedulerInputs {
    bool          enabled          = false;
    uint32_t      cycle_interval_s = DEFAULT_INTERVAL_S;
    PickerMode    picker_mode      = PickerMode::RoundRobin;
    OccupiedSlots occupied;
};

class StateMachine {
public:
    // --- Config ----------------------------------------------------------

    // Validate without applying. Used by the route layer to map back
    // to the `bad_config` slug when the editor pushes an out-of-range
    // interval. Pure function of `in` — no state mutation.
    ConfigVerdict validate_config(const SchedulerInputs& in) const {
        if (in.cycle_interval_s < MIN_CYCLE_INTERVAL_S) return ConfigVerdict::BadInterval;
        if (in.cycle_interval_s > MAX_CYCLE_INTERVAL_S) return ConfigVerdict::BadInterval;
        return ConfigVerdict::Ok;
    }

    // Apply (post-validation) config to the running state. Caller is
    // responsible for clamping or rejecting an invalid `in` first;
    // apply_config silently clamps cycle_interval_s into bounds as a
    // belt-and-braces safety so we can never arm a too-fast / too-slow
    // timer even if the validation step is bypassed (e.g. NVS restore
    // of stale state from an older firmware).
    void apply_config(const SchedulerInputs& in) {
        cycle_interval_s_ = in.cycle_interval_s;
        if (cycle_interval_s_ < MIN_CYCLE_INTERVAL_S) cycle_interval_s_ = MIN_CYCLE_INTERVAL_S;
        if (cycle_interval_s_ > MAX_CYCLE_INTERVAL_S) cycle_interval_s_ = MAX_CYCLE_INTERVAL_S;
        picker_mode_      = in.picker_mode;
        occupied_         = in.occupied;

        // protocol §2.6: "If `enabled: true` is set but no slots are
        // populated, the firmware silently keeps `enabled: false`."
        enabled_ = in.enabled && !occupied_.empty();

        // Recompute current_slot. RoundRobin uses the persisted counter
        // so the cycle resumes where it left off after a power cycle;
        // WallclockHybrid (when synced) is index-derived from time and
        // doesn't read the counter. The counter is only advanced inside
        // RoundRobin advance() — see test_wallclock_hybrid_round_robin_counter_untouched.
        recompute_current_slot(/*rtc_synced_hint=*/false, /*unix_seconds=*/0);
    }

    // --- Pause / resume --------------------------------------------------

    // Pause the cycle for the duration of the awake session. The
    // editor session calls this on a wake-button wake so writes to
    // slots aren't raced by an auto-tick. is_enabled() stays true so
    // the manifest still reflects the configured intent.
    void pause() { paused_ = true; }
    void resume() { paused_ = false; }
    bool is_paused() const { return paused_; }

    // --- Tick scheduling -------------------------------------------------

    // Called by the firmware once a tick render has finished. Records
    // the tick time so /screensaver/manifest can surface last/next.
    void note_tick(uint32_t now_ms) {
        last_tick_ms_ = static_cast<uint64_t>(now_ms);
    }

    // Last tick time in device millis(). nullopt before any tick has run.
    std::optional<uint64_t> last_tick_ms() const {
        return last_tick_ms_ == 0 ? std::optional<uint64_t>{} : std::optional<uint64_t>{last_tick_ms_};
    }

    // Next tick time. uint64 to dodge uint32 wrap. Disabled / paused /
    // never-ticked → returns a sentinel (call _optional() for the
    // nullopt-friendly variant).
    uint64_t next_tick_ms() const {
        return last_tick_ms_ + static_cast<uint64_t>(cycle_interval_s_) * 1000;
    }

    std::optional<uint64_t> next_tick_ms_optional() const {
        if (!enabled_ || paused_) return std::nullopt;
        if (!last_tick_ms().has_value()) return std::nullopt;
        return next_tick_ms();
    }

    // --- Picker ---------------------------------------------------------

    // The single dispatch entry point — picks the next slot using the
    // running picker mode (which falls back when wallclock_hybrid is
    // configured but rtc_synced=false). Tests use the lower-level
    // advance_round_robin() / advance_wallclock_hybrid() to exercise
    // each branch independently.
    void advance(bool rtc_synced, uint64_t unix_seconds) {
        if (!enabled_ || occupied_.empty()) return;
        if (running_mode(rtc_synced) == PickerMode::WallclockHybrid) {
            advance_wallclock_hybrid(unix_seconds);
        } else {
            advance_round_robin(rtc_synced, unix_seconds);
        }
    }

    // Round-robin advance. The counter is incremented and the new
    // slot is the (counter mod N)-th occupied slot. unix_seconds is
    // accepted (and ignored) so callers can pass the same args to
    // either branch from a uniform call site in firmware.
    void advance_round_robin(bool /*rtc_synced*/, uint64_t /*unix_seconds*/) {
        if (occupied_.empty()) {
            current_slot_ = std::nullopt;
            return;
        }
        round_robin_counter_++;
        const uint8_t n = occupied_.count();
        const uint8_t idx = static_cast<uint8_t>(round_robin_counter_ % n);
        current_slot_ = occupied_.nth(idx);
    }

    // Wallclock-hybrid advance. (unix_seconds / interval) mod N selects
    // the index *into the occupied list*. Counter is left alone so a
    // later fall-back to round-robin (after a power cycle) doesn't
    // jump arbitrarily.
    void advance_wallclock_hybrid(uint64_t unix_seconds) {
        if (occupied_.empty()) {
            current_slot_ = std::nullopt;
            return;
        }
        const uint64_t window = unix_seconds / static_cast<uint64_t>(cycle_interval_s_);
        const uint8_t n = occupied_.count();
        const uint8_t idx = static_cast<uint8_t>(window % n);
        current_slot_ = occupied_.nth(idx);
    }

    // --- Round-robin counter persistence --------------------------------

    uint32_t round_robin_counter() const { return round_robin_counter_; }

    void restore_round_robin_counter(uint32_t counter) {
        round_robin_counter_ = counter;
    }

    // --- Accessors ------------------------------------------------------

    bool       is_enabled()       const { return enabled_; }
    uint32_t   cycle_interval_s() const { return cycle_interval_s_; }
    PickerMode picker_mode()      const { return picker_mode_; }

    // Configured vs running mode: "actual" is what the firmware is
    // really doing right now; the editor uses this to surface a
    // "synchronisation pending" hint when WallclockHybrid is configured
    // but rtc_synced=false.
    PickerMode picker_mode_actual(bool rtc_synced) const {
        return running_mode(rtc_synced);
    }

    std::optional<uint8_t> current_slot() const { return current_slot_; }

    const OccupiedSlots& occupied() const { return occupied_; }

private:
    PickerMode running_mode(bool rtc_synced) const {
        if (picker_mode_ == PickerMode::WallclockHybrid && rtc_synced) {
            return PickerMode::WallclockHybrid;
        }
        return PickerMode::RoundRobin;
    }

    void recompute_current_slot(bool rtc_synced_hint, uint64_t unix_seconds) {
        if (!enabled_ || occupied_.empty()) {
            current_slot_ = std::nullopt;
            return;
        }
        if (running_mode(rtc_synced_hint) == PickerMode::WallclockHybrid) {
            const uint64_t window = unix_seconds / static_cast<uint64_t>(cycle_interval_s_);
            const uint8_t n = occupied_.count();
            current_slot_ = occupied_.nth(static_cast<uint8_t>(window % n));
        } else {
            // Map the persisted RR counter to whatever the (possibly
            // changed) occupied set looks like now.
            const uint8_t n = occupied_.count();
            current_slot_ = occupied_.nth(
                static_cast<uint8_t>(round_robin_counter_ % n));
        }
    }

    bool          enabled_              = false;
    bool          paused_               = false;
    uint32_t      cycle_interval_s_     = DEFAULT_INTERVAL_S;
    PickerMode    picker_mode_          = PickerMode::RoundRobin;
    OccupiedSlots occupied_;

    uint32_t      round_robin_counter_  = 0;
    std::optional<uint8_t> current_slot_;

    uint64_t      last_tick_ms_         = 0;  // 0 means "never ticked"
};

}  // namespace screensaver_state
