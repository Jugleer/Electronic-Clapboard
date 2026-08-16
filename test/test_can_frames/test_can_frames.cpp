// Phase 13: pack/unpack contract tests for src/can_frames.h.
//
// These are the tests that protect a CROSS-REPOSITORY contract. The peer
// implementation lives in the Jugglebot tree, so a silent layout change here
// breaks a codebase this test suite cannot see. Where a value is a shared
// golden (the CRC vectors especially), it is written out literally rather
// than computed, so that "the code changed and the test followed it" is
// impossible.

#include <unity.h>

#include <cstring>
#include <string>

#include "can_frames.h"

using namespace can_frames;

void setUp() {}
void tearDown() {}

// ── ID allocation ─────────────────────────────────────────────────────────

static void test_ids_are_inside_the_allocated_block() {
    // 0x7E8-0x7EF is ours; anything drifting outside collides with the
    // catching cone (0x7E0-0x7E1) or the time-sync/tilt/traffic set
    // (0x7DD-0x7DF).
    TEST_ASSERT_EQUAL_HEX32(0x7E8, ID_CLAP_FIELD);
    TEST_ASSERT_EQUAL_HEX32(0x7E9, ID_CLAP_COMMIT);
    TEST_ASSERT_EQUAL_HEX32(0x7EA, ID_CLAP_LINK);
    TEST_ASSERT_EQUAL_HEX32(0x7EB, ID_CLAP_ACK);
    TEST_ASSERT_EQUAL_HEX32(0x7EC, ID_CLAP_HEARTBEAT);
    TEST_ASSERT_EQUAL_HEX32(0x7ED, ID_CLAP_FIRE_EVENT);
    TEST_ASSERT_EQUAL_HEX32(0x7DD, ID_TIME_SYNC);

    TEST_ASSERT_TRUE(ID_CLAP_FIELD      >= ID_CLAP_BLOCK_FIRST);
    TEST_ASSERT_TRUE(ID_CLAP_FIRE_EVENT <= ID_CLAP_BLOCK_LAST);
}

// ── CRC-16/CCITT-FALSE ────────────────────────────────────────────────────

static void test_crc_known_answer_vectors() {
    // The canonical CCITT-FALSE check value: "123456789" -> 0x29B1. If this
    // fails, we have a different CRC variant than the Jetson/Teensy UDP
    // protocol and every commit will be rejected on the wire.
    const char* s = "123456789";
    TEST_ASSERT_EQUAL_HEX16(
        0x29B1, crc16_ccitt_false((const uint8_t*)s, strlen(s)));

    // Empty input returns the init value untouched.
    TEST_ASSERT_EQUAL_HEX16(0xFFFF, crc16_ccitt_false(nullptr, 0));
}

static void test_crc_over_fields_is_order_independent() {
    // The whole reason §8.4 hashes fixed-width NUL-padded buffers rather
    // than trimmed strings: the result must not depend on the order chunks
    // happened to arrive in. Build the same logical field set twice, filling
    // the buffers in opposite orders, and assert the CRC matches.
    uint8_t a[MAX_FIELDS][MAX_FIELD_CHARS];
    uint8_t b[MAX_FIELDS][MAX_FIELD_CHARS];
    memset(a, 0, sizeof(a));
    memset(b, 0, sizeof(b));

    const char* vals[MAX_FIELDS] = {
        "2026-08-16", "Scene 4", "Take 12", "wide", "", "", "", ""
    };
    for (int f = 0; f < MAX_FIELDS; ++f) {
        memcpy(a[f], vals[f], strlen(vals[f]));
    }
    for (int f = MAX_FIELDS - 1; f >= 0; --f) {
        memcpy(b[f], vals[f], strlen(vals[f]));
    }

    const uint8_t mask = 0x0F;  // fields 0-3 present
    TEST_ASSERT_EQUAL_HEX16(crc16_over_fields(a, mask),
                            crc16_over_fields(b, mask));
}

static void test_crc_over_fields_ignores_absent_fields() {
    // A field not named in the mask must not contribute, even if its buffer
    // holds a stale value from a previous transaction. Patch semantics
    // (§8.4) mean stale buffers are the normal case, not an edge case.
    uint8_t f[MAX_FIELDS][MAX_FIELD_CHARS];
    memset(f, 0, sizeof(f));
    memcpy(f[0], "Scene 4", 7);

    const uint16_t only_f0 = crc16_over_fields(f, 0x01);

    memcpy(f[3], "stale leftover", 14);
    TEST_ASSERT_EQUAL_HEX16(only_f0, crc16_over_fields(f, 0x01));

    // ...and including it must change the result, otherwise the mask isn't
    // actually being honoured.
    TEST_ASSERT_NOT_EQUAL(only_f0, crc16_over_fields(f, 0x09));
}

static void test_crc_detects_a_single_bit_flip() {
    uint8_t f[MAX_FIELDS][MAX_FIELD_CHARS];
    memset(f, 0, sizeof(f));
    memcpy(f[1], "Take 12", 7);

    const uint16_t good = crc16_over_fields(f, 0x02);
    f[1][3] ^= 0x01;
    TEST_ASSERT_NOT_EQUAL(good, crc16_over_fields(f, 0x02));
}

// ── CLAP_FIELD ────────────────────────────────────────────────────────────

static void test_field_chunk_round_trip() {
    FieldChunk in{};
    in.field_id = 5;
    in.seq      = 3;
    memcpy(in.text, "abcdefg", 7);

    uint8_t d[8];
    encode_field_chunk(in, d);

    // Layout check, not just round-trip: field_id in the low nibble, seq in
    // the high nibble. A peer implementing from the doc must agree.
    TEST_ASSERT_EQUAL_HEX8(0x35, d[0]);
    TEST_ASSERT_EQUAL_HEX8('a', d[1]);
    TEST_ASSERT_EQUAL_HEX8('g', d[7]);

    FieldChunk out{};
    TEST_ASSERT_TRUE(decode_field_chunk(d, 8, out));
    TEST_ASSERT_EQUAL_UINT8(in.field_id, out.field_id);
    TEST_ASSERT_EQUAL_UINT8(in.seq, out.seq);
    TEST_ASSERT_EQUAL_MEMORY(in.text, out.text, CHUNK_PAYLOAD);
}

static void test_field_chunk_rejects_out_of_range_ids() {
    uint8_t d[8] = {0};
    FieldChunk out{};

    d[0] = 0x08;   // field_id 8, one past MAX_FIELDS-1
    TEST_ASSERT_FALSE(decode_field_chunk(d, 8, out));

    d[0] = 0x50;   // seq 5, one past CHUNKS_PER_FIELD-1
    TEST_ASSERT_FALSE(decode_field_chunk(d, 8, out));

    d[0] = 0x47;   // field 7, seq 4 — both at the limit, must be accepted
    TEST_ASSERT_TRUE(decode_field_chunk(d, 8, out));
    TEST_ASSERT_EQUAL_UINT8(7, out.field_id);
    TEST_ASSERT_EQUAL_UINT8(4, out.seq);
}

static void test_decoders_reject_short_frames() {
    // Every frame in §8 is exactly 8 bytes. Accepting a short DLC would mean
    // reading uninitialised bytes past the end of the CAN payload.
    uint8_t d[8] = {0};
    FieldChunk fc{};
    Commit     c{};
    Link       l{};
    TimeSync   ts{};

    TEST_ASSERT_FALSE(decode_field_chunk(d, 7, fc));
    TEST_ASSERT_FALSE(decode_commit(d, 7, c));
    TEST_ASSERT_FALSE(decode_link(d, 7, l));
    TEST_ASSERT_FALSE(decode_time_sync(d, 7, ts));
}

// ── CLAP_COMMIT ───────────────────────────────────────────────────────────

static void test_commit_round_trip_and_layout() {
    Commit in{};
    in.template_id        = 3;
    in.field_present_mask = 0b00001011;
    in.flags              = COMMIT_FLAG_FULL_REFRESH;
    in.txn_id             = 200;
    in.crc16              = 0xBEEF;

    uint8_t d[8];
    encode_commit(in, d);

    TEST_ASSERT_EQUAL_HEX8(3,          d[0]);
    TEST_ASSERT_EQUAL_HEX8(0b00001011, d[1]);
    TEST_ASSERT_EQUAL_HEX8(0x01,       d[2]);
    TEST_ASSERT_EQUAL_HEX8(200,        d[3]);
    TEST_ASSERT_EQUAL_HEX8(0xEF,       d[4]);   // little-endian
    TEST_ASSERT_EQUAL_HEX8(0xBE,       d[5]);
    TEST_ASSERT_EQUAL_HEX8(0,          d[6]);   // reserved must be zeroed
    TEST_ASSERT_EQUAL_HEX8(0,          d[7]);

    Commit out{};
    TEST_ASSERT_TRUE(decode_commit(d, 8, out));
    TEST_ASSERT_EQUAL_UINT8(in.template_id, out.template_id);
    TEST_ASSERT_EQUAL_UINT8(in.field_present_mask, out.field_present_mask);
    TEST_ASSERT_EQUAL_UINT8(in.flags, out.flags);
    TEST_ASSERT_EQUAL_UINT8(in.txn_id, out.txn_id);
    TEST_ASSERT_EQUAL_HEX16(in.crc16, out.crc16);
}

// ── CLAP_LINK ─────────────────────────────────────────────────────────────

static void test_link_treats_any_nonzero_as_up() {
    uint8_t d[8] = {0};
    Link out{};

    TEST_ASSERT_TRUE(decode_link(d, 8, out));
    TEST_ASSERT_FALSE(out.ros2_up);

    d[0] = 1;
    TEST_ASSERT_TRUE(decode_link(d, 8, out));
    TEST_ASSERT_TRUE(out.ros2_up);

    // A peer adding a flag bit in byte 0 must not silently read as "down" —
    // that failure blanks the panel and looks like a dead robot.
    d[0] = 0x81;
    TEST_ASSERT_TRUE(decode_link(d, 8, out));
    TEST_ASSERT_TRUE(out.ros2_up);
}

// ── Time sync ─────────────────────────────────────────────────────────────

static void test_time_sync_decodes_little_endian_pair() {
    // Mirrors the bridge's pack('<II', sec, usec) in broadcast_0x7dd().
    // 1786000000 == 0x6A743280, so little-endian that is 80 32 74 6A.
    // usec 0x000F4240 == 1'000'000, which is out of range by one.
    uint8_t d[8] = {0x80, 0x32, 0x74, 0x6A,   // sec
                    0x40, 0x42, 0x0F, 0x00};  // usec = 1'000'000 (invalid)
    TimeSync out{};
    // usec == 1e6 is out of range and must be rejected, not folded in — a
    // wrong anchor is worse than no anchor (§8.8).
    TEST_ASSERT_FALSE(decode_time_sync(d, 8, out));

    d[4] = 0x3F; d[5] = 0x42; d[6] = 0x0F; d[7] = 0x00;  // 999_999
    TEST_ASSERT_TRUE(decode_time_sync(d, 8, out));
    TEST_ASSERT_EQUAL_UINT32(1786000000u, out.unix_s);
    TEST_ASSERT_EQUAL_UINT32(999999u, out.usec);
}

// ── CLAP_HEARTBEAT / ACK / FIRE_EVENT ─────────────────────────────────────

static void test_heartbeat_layout() {
    Heartbeat in{};
    in.state              = State::Screensaver;
    in.flags              = HB_FLAG_WIFI_UP | HB_FLAG_TIME_SYNCED;
    in.fires_since_boot   = 0x0102;
    in.rail_mv            = 0;      // no divider fitted
    in.active_template_id = 2;
    in.last_error         = 0x03;

    uint8_t d[8];
    encode_heartbeat(in, d);

    TEST_ASSERT_EQUAL_HEX8(3,    d[0]);          // State::Screensaver
    TEST_ASSERT_EQUAL_HEX8(0x14, d[1]);          // bit2 | bit4
    TEST_ASSERT_EQUAL_HEX8(0x02, d[2]);          // fires LE low
    TEST_ASSERT_EQUAL_HEX8(0x01, d[3]);          // fires LE high
    TEST_ASSERT_EQUAL_HEX8(0x00, d[4]);
    TEST_ASSERT_EQUAL_HEX8(0x00, d[5]);
    TEST_ASSERT_EQUAL_HEX8(2,    d[6]);
    TEST_ASSERT_EQUAL_HEX8(3,    d[7]);
}

static void test_ack_layout() {
    Ack in{};
    in.txn_id    = 42;
    in.outcome   = Outcome::CrcMismatch;
    in.state     = State::Idle;
    in.render_ms = 2500;

    uint8_t d[8];
    encode_ack(in, d);

    TEST_ASSERT_EQUAL_HEX8(42,   d[0]);
    TEST_ASSERT_EQUAL_HEX8(0x02, d[1]);
    TEST_ASSERT_EQUAL_HEX8(0x01, d[2]);
    TEST_ASSERT_EQUAL_HEX8(0xC4, d[3]);   // 2500 = 0x09C4, LE
    TEST_ASSERT_EQUAL_HEX8(0x09, d[4]);
    TEST_ASSERT_EQUAL_HEX8(0,    d[5]);
    TEST_ASSERT_EQUAL_HEX8(0,    d[6]);
    TEST_ASSERT_EQUAL_HEX8(0,    d[7]);
}

static void test_fire_event_48_bit_round_trip() {
    FireEvent in{};
    in.wall_us          = 0x0000'1122'3344'5566ULL;
    in.fires_since_boot = 7;

    uint8_t d[8];
    encode_fire_event(in, d);

    TEST_ASSERT_EQUAL_HEX8(0x66, d[0]);   // LE
    TEST_ASSERT_EQUAL_HEX8(0x11, d[5]);
    TEST_ASSERT_EQUAL_HEX8(7,    d[6]);
    TEST_ASSERT_EQUAL_HEX8(0,    d[7]);

    TEST_ASSERT_EQUAL_UINT64(in.wall_us, decode_fire_event_wall_us(d));
    TEST_ASSERT_EQUAL_UINT16(7, get_u16(d + 6));
}

static void test_fire_event_truncates_above_48_bits_without_corrupting_seq() {
    // 48 bits covers ~8.9 years of microseconds, so this cannot happen with
    // a real unix-epoch timestamp — but if it ever did, the overflow must
    // not bleed into the sequence number in bytes 6-7.
    FireEvent in{};
    in.wall_us          = 0xFFFF'FFFF'FFFF'FFFFULL;
    in.fires_since_boot = 0x1234;

    uint8_t d[8];
    encode_fire_event(in, d);

    TEST_ASSERT_EQUAL_UINT16(0x1234, get_u16(d + 6));
    TEST_ASSERT_EQUAL_UINT64(0x0000'FFFF'FFFF'FFFFULL,
                             decode_fire_event_wall_us(d));
}

// ── Chunking capacity invariant ───────────────────────────────────────────

static void test_max_length_field_still_has_a_nul_terminator() {
    // The decoder finds a field's end by scanning for NUL. A 32-char field
    // spread over 5 seven-byte chunks occupies 32 of 35 bytes, leaving 3
    // pad bytes. If MAX_FIELD_CHARS ever reached 35 this property would
    // vanish silently and full-length fields would run past their buffer.
    TEST_ASSERT_TRUE(CHUNKS_PER_FIELD * CHUNK_PAYLOAD > MAX_FIELD_CHARS);

    uint8_t buf[CHUNKS_PER_FIELD * CHUNK_PAYLOAD];
    memset(buf, 0, sizeof(buf));
    std::string longest(MAX_FIELD_CHARS, 'X');
    memcpy(buf, longest.data(), MAX_FIELD_CHARS);

    TEST_ASSERT_EQUAL_UINT8(0, buf[MAX_FIELD_CHARS]);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_ids_are_inside_the_allocated_block);
    RUN_TEST(test_crc_known_answer_vectors);
    RUN_TEST(test_crc_over_fields_is_order_independent);
    RUN_TEST(test_crc_over_fields_ignores_absent_fields);
    RUN_TEST(test_crc_detects_a_single_bit_flip);
    RUN_TEST(test_field_chunk_round_trip);
    RUN_TEST(test_field_chunk_rejects_out_of_range_ids);
    RUN_TEST(test_decoders_reject_short_frames);
    RUN_TEST(test_commit_round_trip_and_layout);
    RUN_TEST(test_link_treats_any_nonzero_as_up);
    RUN_TEST(test_time_sync_decodes_little_endian_pair);
    RUN_TEST(test_heartbeat_layout);
    RUN_TEST(test_ack_layout);
    RUN_TEST(test_fire_event_48_bit_round_trip);
    RUN_TEST(test_fire_event_truncates_above_48_bits_without_corrupting_seq);
    RUN_TEST(test_max_length_field_still_has_a_nul_terminator);
    return UNITY_END();
}
