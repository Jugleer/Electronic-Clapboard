#include "can.h"

#include <Arduino.h>
#include <WiFi.h>
#include <driver/twai.h>
#include <esp_timer.h>

#include "clap_log.h"
#include "config.h"

// Phase 13 TWAI transport. Module overview lives in can.h.

namespace {

// ── Tunables ──────────────────────────────────────────────────────────────

// 10 Hz, matching the existing catching-cone heartbeat convention on this
// bus. ~0.1% bus utilisation. It also has to comfortably beat the bridge's
// 5 s partner-staleness gate, which it does by 50x.
constexpr uint32_t HEARTBEAT_PERIOD_MS = 100;

// Mirrors the bridge's TIME_ANCHOR_STALE_US (90 s). Both ends must agree on
// what "synced" means or the mode arbitration in §8.5 disagrees across the
// link.
constexpr uint32_t TIME_ANCHOR_STALE_MS = 90000;

// protocol.md §8.5: a CLAP_LINK older than this means the bridge or the
// cable is dead, which resolves to screensaver. 3 s is six missed frames at
// the contract's 2 Hz emission rate.
constexpr uint32_t LINK_STALE_MS = 3000;

// How long to wait for the controller to leave bus-off before re-triggering
// recovery. The TWAI peripheral needs 128 occurrences of 11 consecutive
// recessive bits, which at 1 Mbps is ~1.4 ms of idle bus — but a bus that is
// still faulting will not provide that, so we re-arm rather than spin.
constexpr uint32_t BUS_OFF_RETRY_MS = 1000;

// Blocking timeout on twai_transmit(). The TX queue is 16 deep and we send
// at most a few frames per second, so a full queue means the bus is not
// draining. Fail fast and count it rather than stalling loop().
constexpr uint32_t TX_TIMEOUT_MS = 10;

// ── State ─────────────────────────────────────────────────────────────────

TaskHandle_t g_rx_task = nullptr;

// Written by the RX task, read by loop()/status. Each is a single 32-bit
// word (or a bool), so loads and stores are atomic on the Xtensa LX7 — no
// lock needed for counters that are only ever incremented by one writer and
// read for display. The 64-bit wall-clock anchor is the exception; see
// g_anchor_lock below.
volatile bool     g_driver_up      = false;
volatile bool     g_bus_off        = false;
volatile uint32_t g_rx_frames      = 0;
volatile uint32_t g_rx_dropped     = 0;
volatile uint32_t g_tx_frames      = 0;
volatile uint32_t g_tx_errors      = 0;
volatile uint32_t g_bus_off_events = 0;

volatile bool     g_link_seen      = false;
volatile bool     g_ros2_up        = false;
volatile uint32_t g_last_link_ms   = 0;

// Wall-clock anchor: wall_us at the moment local micros64 was g_anchor_local_us.
// Two 64-bit values that must be read together — a torn read across an
// anchor update would produce a wildly wrong timestamp, which is exactly the
// failure §8.8 says is worse than no timestamp at all. portMUX is the
// cheapest correct guard here (uncontended, sub-microsecond).
portMUX_TYPE g_anchor_lock = portMUX_INITIALIZER_UNLOCKED;
uint64_t     g_anchor_wall_us  = 0;
uint64_t     g_anchor_local_us = 0;
volatile bool     g_have_anchor  = false;
volatile uint32_t g_last_sync_ms = 0;

uint32_t g_next_heartbeat_ms = 0;
uint32_t g_next_recovery_ms  = 0;

// Owned by the fire path via report_fire(); mirrored into the heartbeat.
volatile uint16_t g_fires_since_boot = 0;

uint64_t local_us() { return (uint64_t) esp_timer_get_time(); }

// Age helper that saturates instead of wrapping. millis() rolls over every
// ~49 days; a naive (now - then) on a never-set timestamp yields a huge
// number that happens to read as "very stale", but on a genuine rollover it
// would read as "very fresh" for a moment. Explicit zero-check avoids that.
uint32_t age_ms(uint32_t then_ms, bool ever) {
    if (!ever) return UINT32_MAX;
    return millis() - then_ms;
}

// ── Transmit ──────────────────────────────────────────────────────────────

bool tx(uint32_t id, const uint8_t* data, uint8_t len) {
    if (!g_driver_up || g_bus_off) return false;

    twai_message_t msg = {};
    msg.identifier       = id;
    msg.data_length_code = len;
    msg.extd             = 0;   // 11-bit standard IDs (protocol.md §8.1)
    msg.rtr              = 0;
    memcpy(msg.data, data, len);

    const esp_err_t err = twai_transmit(&msg, pdMS_TO_TICKS(TX_TIMEOUT_MS));
    if (err == ESP_OK) {
        g_tx_frames++;
        return true;
    }
    g_tx_errors++;
    return false;
}

void send_heartbeat() {
    can_frames::Heartbeat hb{};
    // Phase 13 has no template store and no renderer yet, so state is Idle
    // and template_loaded is clear. Phases 16/17 replace this with the real
    // mode and transaction state.
    hb.state              = can_frames::State::Idle;
    hb.flags              = 0;
    if (WiFi.status() == WL_CONNECTED) hb.flags |= can_frames::HB_FLAG_WIFI_UP;
    if (can_link::time_synced())       hb.flags |= can_frames::HB_FLAG_TIME_SYNCED;
    // No rail divider fitted (config.h CLAPBOARD_HAS_RAIL_ADC), so rail_mv
    // stays 0 and RAIL_OK stays clear. 0 is distinguishable from a real
    // reading, which is the point.
    hb.fires_since_boot   = g_fires_since_boot;
    hb.rail_mv            = 0;
    hb.active_template_id = 0;
    hb.last_error         = 0;

    uint8_t d[8];
    can_frames::encode_heartbeat(hb, d);
    tx(can_frames::ID_CLAP_HEARTBEAT, d, 8);
}

// ── Receive ───────────────────────────────────────────────────────────────

void handle_time_sync(const twai_message_t& m) {
    can_frames::TimeSync ts{};
    if (!can_frames::decode_time_sync(m.data, m.data_length_code, ts)) {
        g_rx_dropped++;
        return;
    }
    const uint64_t wall = (uint64_t) ts.unix_s * 1000000ULL + ts.usec;
    const uint64_t now  = local_us();

    portENTER_CRITICAL(&g_anchor_lock);
    g_anchor_wall_us  = wall;
    g_anchor_local_us = now;
    portEXIT_CRITICAL(&g_anchor_lock);

    const bool first = !g_have_anchor;
    g_have_anchor  = true;
    g_last_sync_ms = millis();
    if (first) {
        clap_log("[can] time anchored from 0x7DD: unix=%lu.%06lu",
                 (unsigned long) ts.unix_s, (unsigned long) ts.usec);
    }
}

void handle_link(const twai_message_t& m) {
    can_frames::Link link{};
    if (!can_frames::decode_link(m.data, m.data_length_code, link)) {
        g_rx_dropped++;
        return;
    }
    const bool changed = (!g_link_seen) || (g_ros2_up != link.ros2_up);
    g_link_seen    = true;
    g_ros2_up      = link.ros2_up;
    g_last_link_ms = millis();
    if (changed) {
        clap_log("[can] CLAP_LINK: ROS2 %s", link.ros2_up ? "UP" : "DOWN");
    }
}

void handle_frame(const twai_message_t& m) {
    // Extended-ID or RTR frames are not part of this contract. Count and
    // drop rather than trying to interpret them — on a shared bus, silently
    // reinterpreting someone else's frame format is how you get a very
    // confusing bug.
    if (m.extd || m.rtr) { g_rx_dropped++; return; }

    switch (m.identifier) {
        case can_frames::ID_TIME_SYNC:
            handle_time_sync(m);
            break;
        case can_frames::ID_CLAP_LINK:
            handle_link(m);
            break;
        case can_frames::ID_CLAP_FIELD:
        case can_frames::ID_CLAP_COMMIT:
            // Phase 16 consumes these. Counted as received so bench testing
            // can confirm the downlink works before the reassembler exists.
            break;
        default:
            // Anything else on this bus is not ours. With the clapboard as
            // the sole peripheral this should be rare, but the cone shares
            // the ID space by convention and a mis-plug is possible.
            g_rx_dropped++;
            return;
    }
    g_rx_frames++;
}

void rx_task(void*) {
    for (;;) {
        twai_message_t msg;
        // 100 ms block: long enough that the task is idle almost always,
        // short enough that a driver restart is noticed promptly.
        if (twai_receive(&msg, pdMS_TO_TICKS(100)) == ESP_OK) {
            handle_frame(msg);
        }
    }
}

// ── Bus-off recovery ──────────────────────────────────────────────────────

void service_bus_state() {
    twai_status_info_t st;
    if (twai_get_status_info(&st) != ESP_OK) return;

    if (st.state == TWAI_STATE_BUS_OFF) {
        if (!g_bus_off) {
            g_bus_off = true;
            g_bus_off_events++;
            clap_log("[can] BUS-OFF entered (tx_err=%lu rx_err=%lu) — recovering",
                     (unsigned long) st.tx_error_counter,
                     (unsigned long) st.rx_error_counter);
        }
        // twai_initiate_recovery() only succeeds from BUS_OFF, and the
        // controller then needs the bus to go idle before it returns to
        // STOPPED. Re-arm on a timer rather than spinning: a bus that is
        // still faulting will refuse, and hammering it just burns loop().
        if ((int32_t)(millis() - g_next_recovery_ms) >= 0) {
            twai_initiate_recovery();
            g_next_recovery_ms = millis() + BUS_OFF_RETRY_MS;
        }
    } else if (st.state == TWAI_STATE_STOPPED) {
        // Recovery completed — the driver parks in STOPPED and needs an
        // explicit restart before it will carry traffic again. Missing this
        // is the classic "recovered but permanently silent" TWAI bug.
        if (twai_start() == ESP_OK) {
            g_bus_off = false;
            clap_log("[can] bus recovered and restarted");
        }
    } else {
        g_bus_off = false;
    }
}

}  // namespace

namespace can_link {

void begin() {
    // TWAI_MODE_NORMAL: we ACK other nodes' frames and expect ours to be
    // ACKed. NO_ACK / LISTEN_ONLY would make bring-up "work" against a dead
    // bus and hide exactly the fault we are trying to detect.
    twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(
        (gpio_num_t) PIN_CAN_TX, (gpio_num_t) PIN_CAN_RX, TWAI_MODE_NORMAL);
    g.rx_queue_len = 32;   // 100 Hz time-sync + bursts; task drains at 100 ms worst case
    g.tx_queue_len = 16;

    static_assert(CAN_BITRATE_BPS == 1000000,
                  "timing config below is the 1 Mbps preset — update both together");
    twai_timing_config_t t = TWAI_TIMING_CONFIG_1MBITS();

    // Accept everything. Filtering in silicon would save a few interrupts,
    // but this bus is nearly idle and a permissive filter means rx_dropped
    // actually tells us when something unexpected is on the wire.
    twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();

    esp_err_t err = twai_driver_install(&g, &t, &f);
    if (err != ESP_OK) {
        clap_log("[can] driver_install FAILED (%d) — CAN disabled, "
                 "editor path unaffected", (int) err);
        return;
    }
    err = twai_start();
    if (err != ESP_OK) {
        clap_log("[can] start FAILED (%d) — CAN disabled", (int) err);
        twai_driver_uninstall();
        return;
    }

    g_driver_up = true;

    // Priority 2: above the Arduino loop task (1) so a 100 Hz broadcast is
    // never starved by a 3 s e-paper refresh, below the Wi-Fi/TCP stack.
    // Pinned to core 0 to keep it off the core running loop() and AsyncTCP.
    xTaskCreatePinnedToCore(rx_task, "can_rx", 4096, nullptr, 2, &g_rx_task, 0);

    // Heartbeat immediately, not one period from now. See can.h — the
    // bridge will not transmit to us until it has heard from us, so the
    // first frame out of the gate should be ours.
    g_next_heartbeat_ms = millis();

    clap_log("[can] up: 1 Mbps, TX=GPIO%u RX=GPIO%u, heartbeat %lu ms, "
             "IDs 0x%03X-0x%03X",
             (unsigned) PIN_CAN_TX, (unsigned) PIN_CAN_RX,
             (unsigned long) HEARTBEAT_PERIOD_MS,
             (unsigned) can_frames::ID_CLAP_BLOCK_FIRST,
             (unsigned) can_frames::ID_CLAP_BLOCK_LAST);
}

void service() {
    if (!g_driver_up) return;

    service_bus_state();

    // Signed comparison so this survives millis() rollover.
    if ((int32_t)(millis() - g_next_heartbeat_ms) >= 0) {
        g_next_heartbeat_ms = millis() + HEARTBEAT_PERIOD_MS;
        send_heartbeat();
    }
}

void report_fire(uint32_t fires_since_boot) {
    g_fires_since_boot = (uint16_t) fires_since_boot;

    if (!time_synced()) {
        // protocol.md §8.8: emit nothing rather than a bogus timestamp.
        clap_log("[can] fire not reported — no time anchor "
                 "(a missing sync record beats a wrong one)");
        return;
    }

    can_frames::FireEvent ev{};
    ev.wall_us          = wall_us();
    ev.fires_since_boot = (uint16_t) fires_since_boot;

    uint8_t d[8];
    can_frames::encode_fire_event(ev, d);
    if (tx(can_frames::ID_CLAP_FIRE_EVENT, d, 8)) {
        clap_log("[can] CLAP_FIRE_EVENT n=%lu wall=%llu us",
                 (unsigned long) fires_since_boot,
                 (unsigned long long) ev.wall_us);
    }
}

uint64_t wall_us() {
    if (!g_have_anchor) return 0;
    uint64_t anchor_wall, anchor_local;
    portENTER_CRITICAL(&g_anchor_lock);
    anchor_wall  = g_anchor_wall_us;
    anchor_local = g_anchor_local_us;
    portEXIT_CRITICAL(&g_anchor_lock);
    return anchor_wall + (local_us() - anchor_local);
}

bool time_synced() {
    if (!g_have_anchor) return false;
    return age_ms(g_last_sync_ms, true) <= TIME_ANCHOR_STALE_MS;
}

bool should_show_scene() {
    // protocol.md §8.5, in priority order. Every failure path converges on
    // "false" (screensaver) so that a screensaver on the panel is always a
    // true statement about upstream health.
    if (!g_link_seen) return false;                                  // boot default
    if (!g_ros2_up)   return false;                                  // explicit DOWN
    if (age_ms(g_last_link_ms, true) > LINK_STALE_MS) return false;  // bridge/cable dead
    if (!time_synced()) return false;                                // 0x7DD backstop
    return true;
}

Stats stats() {
    Stats s{};
    s.driver_up      = g_driver_up;
    s.bus_off        = g_bus_off;
    s.rx_frames      = g_rx_frames;
    s.rx_dropped     = g_rx_dropped;
    s.tx_frames      = g_tx_frames;
    s.tx_errors      = g_tx_errors;
    s.bus_off_events = g_bus_off_events;
    s.time_synced    = time_synced();
    s.link_seen      = g_link_seen;
    s.ros2_up        = g_ros2_up;
    s.ms_since_link  = age_ms(g_last_link_ms, g_link_seen);
    s.ms_since_sync  = age_ms(g_last_sync_ms, g_have_anchor);
    return s;
}

}  // namespace can_link
