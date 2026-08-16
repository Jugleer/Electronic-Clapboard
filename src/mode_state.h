#pragma once

// Phase 17: what the panel should be showing, resolved from CAN liveness.
//
// Header-only and Arduino-free so the protocol.md §8.5 truth table can be
// exercised natively — it is the rule most likely to be got subtly wrong,
// and the one whose failure is least visible on a bench.
//
// THE DESIGN INTENT: the clapboard's display doubles as a ROS2 health
// indicator. "Screensaver showing" must be a true statement about upstream
// health in EVERY failure mode, which is why arbitration is push-primary
// with two staleness backstops rather than push alone.
//
// Push alone has a blind spot that matters more under this framing than it
// would otherwise: if the Teensy dies or the cable is pulled, nobody is left
// to send "ROS2 is down", so a push-only design would leave the last scene
// frame on the panel indefinitely — displaying the HEALTHIEST state during
// the SEVEREST failure. The staleness rules close that.

#include <cstdint>

namespace mode_state {

enum class Mode : uint8_t {
    Screensaver = 0,  // boot default, and every failure path
    Scene       = 1,  // template + live fields
};

// A CLAP_LINK older than this means the bridge or the cable is gone. Six
// missed frames at the contract's 2 Hz emission rate — generous enough that
// a momentary hiccup does not flip the panel, tight enough that a genuinely
// dead link is obvious within a few seconds.
constexpr uint32_t LINK_STALE_MS = 3000;

// Backstop. The bridge suppresses its 0x7DD broadcast once its own Jetson
// anchor goes stale, so the frame's absence is already a ROS2-liveness
// signal — just a slow one. This catches a CLAP_LINK that was never
// implemented, or one lost to a firmware mismatch.
constexpr uint32_t SYNC_STALE_MS = 90000;

struct Inputs {
    bool     link_seen;      // a CLAP_LINK has arrived at least once
    bool     ros2_up;        // most recent CLAP_LINK state
    uint32_t ms_since_link;  // UINT32_MAX when never
    bool     time_synced;    // a fresh 0x7DD anchor exists
};

// Resolve the mode. Every path that is not "everything is demonstrably
// healthy" returns Screensaver.
inline Mode resolve(const Inputs& in) {
    // Boot: nothing heard yet. Screensaver is the safe default — showing a
    // blank scene template before the robot has said anything would imply a
    // live link that does not exist.
    if (!in.link_seen) return Mode::Screensaver;

    // Explicit "ROS2 is down" from the bridge. The prompt path.
    if (!in.ros2_up) return Mode::Screensaver;

    // The bridge said UP, but has since gone quiet — bridge or cable dead.
    if (in.ms_since_link > LINK_STALE_MS) return Mode::Screensaver;

    // Backstop: no time-sync means either the bridge lost its Jetson anchor
    // or we never had one. Also guarantees the date autofill has a clock
    // before Scene mode can claim to show a date.
    if (!in.time_synced) return Mode::Screensaver;

    return Mode::Scene;
}

inline const char* name(Mode m) {
    return m == Mode::Scene ? "scene" : "screensaver";
}

// Edge detector. Callers act on transitions — clearing fields and
// autofilling the date on Scene entry, starting the slate cycle on
// Screensaver entry — so they need change detection, not just current
// state. Keeping it here means the "first resolve is a transition" rule is
// tested rather than re-derived at each call site.
class Tracker {
public:
    struct Step {
        Mode mode;
        bool changed;
    };

    Step update(const Inputs& in) {
        const Mode m = resolve(in);
        // The first call always reports a change so the caller runs its
        // entry actions once at boot rather than only on the first flip.
        const bool changed = !primed_ || m != mode_;
        mode_   = m;
        primed_ = true;
        return { m, changed };
    }

    Mode mode() const { return mode_; }
    bool primed() const { return primed_; }
    void reset() { primed_ = false; mode_ = Mode::Screensaver; }

private:
    Mode mode_   = Mode::Screensaver;
    bool primed_ = false;
};

}  // namespace mode_state
