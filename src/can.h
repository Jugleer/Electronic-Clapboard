#pragma once

// Phase 13: TWAI (classic CAN 2.0B) link to the Jugglebot CAN3 drop.
//
// Owns:
//   - the ESP32-S3's single TWAI controller at 1 Mbps on PIN_CAN_TX / PIN_CAN_RX
//   - a dedicated FreeRTOS RX task (loop() ticks at 50 ms, far too slow for a
//     100 Hz time-sync broadcast — polling from loop() would drop frames)
//   - the 10 Hz CLAP_HEARTBEAT emitter
//   - wall-clock slaving to the bridge's 0x7DD broadcast
//   - CLAP_FIRE_EVENT emission
//   - bus-off detection and recovery
//
// Does NOT own: field reassembly, template state, or rendering. Those are
// Phase 16 (clap_txn.h) and consume decoded frames from here. This module is
// transport only — payload bytes are packed and unpacked exclusively by
// can_frames.h.
//
// THE ONE NON-OBVIOUS REQUIREMENT (protocol.md §8.1):
// The heartbeat must transmit from boot, unconditionally, before we have
// heard anything. The can-bridge gates every transmission on having seen a
// partner frame on that bus within 5 s (can_buses.cpp partner_recent()),
// because an un-ACKed TX on a partner-less bus retransmits forever and pins
// its TX error counter at error-passive. A clapboard that waits to be spoken
// to first will never be spoken to, and the failure presents as "the bridge
// is broken".

#include <cstdint>

#include "can_frames.h"

namespace can_link {

// Snapshot for /status and diagnostics. Counters are cumulative since boot.
struct Stats {
    bool     driver_up;        // TWAI installed and started
    bool     bus_off;          // controller currently in bus-off
    uint32_t rx_frames;        // total accepted frames
    uint32_t rx_dropped;       // malformed / unknown-ID frames
    uint32_t tx_frames;        // successful transmits
    uint32_t tx_errors;        // transmit failures (queue full, timeout, bus-off)
    uint32_t bus_off_events;   // times we entered bus-off and recovered
    bool     time_synced;      // a fresh 0x7DD anchor exists
    bool     link_seen;        // a CLAP_LINK has ever arrived
    bool     ros2_up;          // last CLAP_LINK state (meaningless if !link_seen)
    uint32_t ms_since_link;    // age of the last CLAP_LINK, UINT32_MAX if never
    uint32_t ms_since_sync;    // age of the last 0x7DD, UINT32_MAX if never
};

// Install and start the TWAI driver, spawn the RX task, and begin
// heartbeating. Safe to call once from setup(). Logs and returns without
// throwing if the driver fails to install — the rest of the firmware must
// still run with no CAN (the editor path is independent).
void begin();

// Pump the periodic transmits (heartbeat) and service bus-off recovery.
// Call every loop() tick. Cheap: does nothing until the next heartbeat is
// due. RX is handled by the task, not here.
void service();

// Emit one CLAP_FIRE_EVENT. Called from the fire path on an accepted press.
//
// Silently does nothing when the wall clock has never been anchored. That is
// deliberate: a missing sync record is recoverable in post, a confidently
// wrong one silently corrupts an edit (protocol.md §8.8).
void report_fire(uint32_t fires_since_boot);

// Wall clock derived from the bridge's 0x7DD broadcast, in microseconds
// since the unix epoch. Returns 0 when never anchored — check time_synced()
// rather than testing for 0 at a call site that cares.
uint64_t wall_us();

// True when a 0x7DD anchor exists AND is fresher than TIME_ANCHOR_STALE_MS.
// Mirrors the bridge's own time_synced() semantics so both ends agree on
// what "synced" means.
bool time_synced();

// Current display mode per the protocol.md §8.5 truth table. Phase 17 wires
// this to the screensaver; exposed now so Phase 13 can be bench-verified.
bool should_show_scene();

Stats stats();

}  // namespace can_link
