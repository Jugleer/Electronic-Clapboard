#pragma once

// Phase 13: pure pack/unpack for the CAN wire contract (protocol.md §8).
//
// Header-only and Arduino-free so it links into [env:native], mirroring
// fire_state.h / lockin_state.h / screensaver_state.h. Every byte layout in
// protocol.md §8 has exactly one encoder and one decoder here, and the
// round-trip is unit-tested — the driver in can.cpp does transport only and
// never touches a payload byte directly.
//
// CROSS-REPOSITORY CONTRACT. The peer implementation lives in the Jugglebot
// tree (Teensy_code_canbridge/ and teensy_bridge_node.py). Changing a layout
// here without changing it there silently breaks the link — see
// docs/can-integration-handoff.md.
//
// Endianness: every multi-byte field is little-endian, matching both the
// Jetson↔Teensy UDP protocol and the 0x7DD time-sync frame's `<II` packing.
// The ESP32-S3 is little-endian, but we still pack byte-by-byte rather than
// memcpy'ing structs — struct layout is a compiler promise, a wire format is
// a contract with another codebase.

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace can_frames {

// ── Arbitration IDs (protocol.md §8.2) ────────────────────────────────────
// 0x7E8-0x7EF is the clapboard block. Existing Jugglebot allocations stop at
// 0x7E1 (catching_cone.HEARTBEAT); 0x7DD/0x7DE/0x7DF are time-sync, tilt and
// traffic-report.
constexpr uint32_t ID_TIME_SYNC      = 0x7DD;  // bridge→clap, consumed not defined here
constexpr uint32_t ID_CLAP_FIELD     = 0x7E8;  // J→C
constexpr uint32_t ID_CLAP_COMMIT    = 0x7E9;  // J→C
constexpr uint32_t ID_CLAP_LINK      = 0x7EA;  // bridge→C
constexpr uint32_t ID_CLAP_ACK       = 0x7EB;  // C→J
constexpr uint32_t ID_CLAP_HEARTBEAT = 0x7EC;  // C→J
constexpr uint32_t ID_CLAP_FIRE_EVENT = 0x7ED; // C→J

constexpr uint32_t ID_CLAP_BLOCK_FIRST = 0x7E8;
constexpr uint32_t ID_CLAP_BLOCK_LAST  = 0x7EF;

// ── Field model (protocol.md §8.3) ────────────────────────────────────────
constexpr uint8_t  MAX_FIELDS      = 8;
constexpr uint8_t  MAX_FIELD_CHARS = 32;
constexpr uint8_t  CHUNK_PAYLOAD   = 7;   // text bytes per CLAP_FIELD frame
// ceil(32/7) = 5 chunks → 35 byte capacity, so a 32-char maximum guarantees
// at least 3 trailing NUL pad bytes and the receiver can always find the
// terminator without a length field. static_assert keeps that true if the
// constants ever move.
constexpr uint8_t  CHUNKS_PER_FIELD = 5;
static_assert(CHUNKS_PER_FIELD * CHUNK_PAYLOAD > MAX_FIELD_CHARS,
              "chunk capacity must exceed MAX_FIELD_CHARS so a NUL terminator "
              "always fits — otherwise a full-length field has no terminator");
static_assert(MAX_FIELDS <= 8, "field_present_mask is one byte");

// ── Clapboard state, as reported in CLAP_HEARTBEAT byte 0 (§8.7) ──────────
enum class State : uint8_t {
    Boot        = 0,
    Idle        = 1,
    Rendering   = 2,
    Screensaver = 3,
    Error       = 4,
};

// CLAP_HEARTBEAT byte 1 flag bits (§8.7).
constexpr uint8_t HB_FLAG_FIRE_READY      = 1u << 0;
constexpr uint8_t HB_FLAG_TEMPLATE_LOADED = 1u << 1;
constexpr uint8_t HB_FLAG_WIFI_UP         = 1u << 2;
constexpr uint8_t HB_FLAG_RAIL_OK         = 1u << 3;
constexpr uint8_t HB_FLAG_TIME_SYNCED     = 1u << 4;

// ── CLAP_ACK outcomes (§8.6) ──────────────────────────────────────────────
enum class Outcome : uint8_t {
    Ok           = 0x00,
    Rejected     = 0x01,
    CrcMismatch  = 0x02,
    Incomplete   = 0x03,
    Busy         = 0x04,
    NoTemplate   = 0x05,
    BadFieldId   = 0x06,
};

// ── Decoded frame payloads ────────────────────────────────────────────────

struct TimeSync {
    uint32_t unix_s;
    uint32_t usec;
};

struct FieldChunk {
    uint8_t field_id;               // 0..MAX_FIELDS-1
    uint8_t seq;                    // 0..CHUNKS_PER_FIELD-1
    uint8_t text[CHUNK_PAYLOAD];    // NUL-padded
};

struct Commit {
    uint8_t  template_id;
    uint8_t  field_present_mask;
    uint8_t  flags;
    uint8_t  txn_id;
    uint16_t crc16;
};
constexpr uint8_t COMMIT_FLAG_FULL_REFRESH = 1u << 0;

struct Link {
    bool ros2_up;
};

struct Ack {
    uint8_t  txn_id;
    Outcome  outcome;
    State    state;
    uint16_t render_ms;
};

struct Heartbeat {
    State    state;
    uint8_t  flags;
    uint16_t fires_since_boot;
    uint16_t rail_mv;          // 0 when no divider is fitted — see config.h
    uint8_t  active_template_id;
    uint8_t  last_error;
};

struct FireEvent {
    uint64_t wall_us;          // 48-bit on the wire
    uint16_t fires_since_boot;
};

// ── Little-endian helpers ─────────────────────────────────────────────────

inline void put_u16(uint8_t* p, uint16_t v) {
    p[0] = (uint8_t)(v & 0xFF);
    p[1] = (uint8_t)((v >> 8) & 0xFF);
}

inline uint16_t get_u16(const uint8_t* p) {
    return (uint16_t)(p[0] | ((uint16_t)p[1] << 8));
}

inline uint32_t get_u32(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8)
         | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

// ── CRC-16/CCITT-FALSE (§8.4) ─────────────────────────────────────────────
// poly 0x1021, init 0xFFFF, no input/output reflection, no final XOR. Same
// variant the Jetson↔Teensy UDP protocol uses, deliberately — both ends of
// this link already have an implementation to cross-check against.
inline uint16_t crc16_ccitt_false(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; ++i) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; ++b) {
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021)
                                 : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

// CRC over a committed field set, per §8.4: the concatenation of each
// present field's 32-byte NUL-padded buffer, in ascending field_id order.
//
// Padding to a fixed width rather than hashing the trimmed strings is what
// makes the CRC independent of chunk arrival order — the sender cannot know
// what the receiver's trimmed view will be until reassembly completes, so
// hashing trimmed text would make the check order-dependent and useless.
inline uint16_t crc16_over_fields(const uint8_t fields[MAX_FIELDS][MAX_FIELD_CHARS],
                                  uint8_t present_mask) {
    uint16_t crc = 0xFFFF;
    for (uint8_t f = 0; f < MAX_FIELDS; ++f) {
        if (!(present_mask & (1u << f))) continue;
        for (uint8_t i = 0; i < MAX_FIELD_CHARS; ++i) {
            crc ^= (uint16_t)fields[f][i] << 8;
            for (int b = 0; b < 8; ++b) {
                crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021)
                                     : (uint16_t)(crc << 1);
            }
        }
    }
    return crc;
}

// ── Decoders (bridge/Jetson → clapboard) ──────────────────────────────────
// Each returns false on a malformed frame and leaves `out` untouched. `len`
// is the CAN DLC; we require exactly 8 because every frame in §8 is 8 bytes.
// Accepting short frames would mean reading uninitialised buffer bytes.

inline bool decode_time_sync(const uint8_t* d, uint8_t len, TimeSync& out) {
    if (len != 8) return false;
    out.unix_s = get_u32(d);
    out.usec   = get_u32(d + 4);
    // A usec field >= 1e6 means the sender is not packing `<II` as the
    // contract says. Reject rather than fold it in: a bad time anchor is
    // worse than no time anchor, because CLAP_FIRE_EVENT would then carry a
    // confidently wrong timestamp into someone's edit.
    if (out.usec >= 1000000u) return false;
    return true;
}

inline bool decode_field_chunk(const uint8_t* d, uint8_t len, FieldChunk& out) {
    if (len != 8) return false;
    const uint8_t field_id = (uint8_t)(d[0] & 0x0F);
    const uint8_t seq      = (uint8_t)((d[0] >> 4) & 0x0F);
    if (field_id >= MAX_FIELDS)      return false;
    if (seq      >= CHUNKS_PER_FIELD) return false;
    out.field_id = field_id;
    out.seq      = seq;
    memcpy(out.text, d + 1, CHUNK_PAYLOAD);
    return true;
}

inline bool decode_commit(const uint8_t* d, uint8_t len, Commit& out) {
    if (len != 8) return false;
    out.template_id        = d[0];
    out.field_present_mask = d[1];
    out.flags              = d[2];
    out.txn_id             = d[3];
    out.crc16              = get_u16(d + 4);
    return true;
}

inline bool decode_link(const uint8_t* d, uint8_t len, Link& out) {
    if (len != 8) return false;
    // Any non-zero is "up". Strict ==1 would turn a future flag bit added by
    // the peer into a silent permanent "ROS2 down", which fails in the
    // direction that blanks the panel.
    out.ros2_up = (d[0] != 0);
    return true;
}

// ── Encoders (clapboard → bridge/Jetson) ──────────────────────────────────
// Each writes exactly 8 bytes and zero-fills reserved fields. Reserved bytes
// are explicitly zeroed rather than left alone so the peer can rely on them,
// and so a future allocation of those bytes is a visible change here.

inline void encode_ack(const Ack& in, uint8_t* d) {
    memset(d, 0, 8);
    d[0] = in.txn_id;
    d[1] = (uint8_t)in.outcome;
    d[2] = (uint8_t)in.state;
    put_u16(d + 3, in.render_ms);
    // d[5..7] reserved
}

inline void encode_heartbeat(const Heartbeat& in, uint8_t* d) {
    memset(d, 0, 8);
    d[0] = (uint8_t)in.state;
    d[1] = in.flags;
    put_u16(d + 2, in.fires_since_boot);
    put_u16(d + 4, in.rail_mv);
    d[6] = in.active_template_id;
    d[7] = in.last_error;
}

inline void encode_fire_event(const FireEvent& in, uint8_t* d) {
    memset(d, 0, 8);
    // 48-bit little-endian microseconds: ~8.9 years of range, which leaves
    // room for the sequence number in the same 8-byte payload.
    uint64_t us = in.wall_us & 0x0000FFFFFFFFFFFFULL;
    for (int i = 0; i < 6; ++i) {
        d[i] = (uint8_t)(us & 0xFF);
        us >>= 8;
    }
    put_u16(d + 6, in.fires_since_boot);
}

inline uint64_t decode_fire_event_wall_us(const uint8_t* d) {
    uint64_t us = 0;
    for (int i = 5; i >= 0; --i) {
        us = (us << 8) | d[i];
    }
    return us;
}

// Encode one CLAP_FIELD chunk. Provided mainly so the native tests can
// round-trip the decoder against a known-good encoder; on the clapboard
// itself this direction is only ever received.
inline void encode_field_chunk(const FieldChunk& in, uint8_t* d) {
    memset(d, 0, 8);
    d[0] = (uint8_t)((in.field_id & 0x0F) | ((in.seq & 0x0F) << 4));
    memcpy(d + 1, in.text, CHUNK_PAYLOAD);
}

inline void encode_commit(const Commit& in, uint8_t* d) {
    memset(d, 0, 8);
    d[0] = in.template_id;
    d[1] = in.field_present_mask;
    d[2] = in.flags;
    d[3] = in.txn_id;
    put_u16(d + 4, in.crc16);
}

inline void encode_link(const Link& in, uint8_t* d) {
    memset(d, 0, 8);
    d[0] = in.ros2_up ? 1u : 0u;
}

}  // namespace can_frames
