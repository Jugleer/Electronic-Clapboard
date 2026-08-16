// Phase 16/17: CAN transaction machine and display-mode arbitration.
//
// These cover the two rules whose failure is least visible on a bench: a
// transaction that half-applies (the panel shows a mix of two shots) and a
// mode arbitration that shows the healthy state during a failure.

#include <unity.h>

#include <cstring>
#include <string>

#include "clap_txn.h"
#include "mode_state.h"

using namespace clap_txn;

void setUp() {}
void tearDown() {}

namespace {

// Stage a whole field value as the sender would: chunk it into 7-byte
// CLAP_FIELD payloads.
void stage(Txn& t, uint8_t field_id, const char* value) {
    const size_t len = strlen(value);
    for (uint8_t seq = 0; seq < can_frames::CHUNKS_PER_FIELD; ++seq) {
        const size_t off = (size_t) seq * can_frames::CHUNK_PAYLOAD;
        if (off >= len && seq > 0) break;   // seq 0 always sent, even for ""
        can_frames::FieldChunk c{};
        c.field_id = field_id;
        c.seq      = seq;
        for (uint8_t i = 0; i < can_frames::CHUNK_PAYLOAD; ++i) {
            const size_t src = off + i;
            c.text[i] = (src < len) ? (uint8_t) value[src] : 0;
        }
        t.add_chunk(c);
    }
}

// The CRC a correct sender would put in the commit.
uint16_t crc_for(const char* const values[MAX_FIELDS], uint8_t mask) {
    uint8_t buf[MAX_FIELDS][MAX_CHARS];
    memset(buf, 0, sizeof(buf));
    for (uint8_t f = 0; f < MAX_FIELDS; ++f) {
        if (!(mask & (1u << f)) || !values[f]) continue;
        const size_t n = strlen(values[f]);
        memcpy(buf[f], values[f], n > MAX_CHARS ? MAX_CHARS : n);
    }
    return can_frames::crc16_over_fields(buf, mask);
}

can_frames::Commit make_commit(uint8_t mask, uint16_t crc, uint8_t txn_id,
                               uint8_t template_id = 0) {
    can_frames::Commit cm{};
    cm.template_id        = template_id;
    cm.field_present_mask = mask;
    cm.flags              = 0;
    cm.txn_id             = txn_id;
    cm.crc16              = crc;
    return cm;
}

}  // namespace

// ── Happy path ────────────────────────────────────────────────────────────

static void test_single_field_applies() {
    Txn t; t.reset();
    stage(t, 2, "SC 14");

    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    const auto r = t.commit(make_commit(0x04, crc_for(vals, 0x04), 1), false, true);

    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, r.outcome);
    TEST_ASSERT_TRUE(r.apply);
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

static void test_chunks_may_arrive_in_any_order() {
    // §8.3 says order-independent, and the fixed-width CRC is what makes it
    // so. Stage the last chunk first.
    Txn t; t.reset();
    const char* v = "ABCDEFGHIJKLMN";   // 14 chars = 2 chunks

    can_frames::FieldChunk c1{};
    c1.field_id = 0; c1.seq = 1;
    memcpy(c1.text, v + 7, 7);
    t.add_chunk(c1);

    can_frames::FieldChunk c0{};
    c0.field_id = 0; c0.seq = 0;
    memcpy(c0.text, v, 7);
    t.add_chunk(c0);

    const char* vals[MAX_FIELDS] = { v, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    const auto r = t.commit(make_commit(0x01, crc_for(vals, 0x01), 1), false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, r.outcome);
    TEST_ASSERT_EQUAL_STRING(v, t.value(0));
}

static void test_max_length_field_survives_intact() {
    Txn t; t.reset();
    const std::string v(MAX_CHARS, 'X');
    stage(t, 7, v.c_str());

    const char* vals[MAX_FIELDS] = { nullptr, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, v.c_str() };
    const auto r = t.commit(make_commit(0x80, crc_for(vals, 0x80), 3), false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, r.outcome);
    TEST_ASSERT_EQUAL_STRING(v.c_str(), t.value(7));
    TEST_ASSERT_EQUAL_UINT32(MAX_CHARS, strlen(t.value(7)));
}

// ── Patch semantics ───────────────────────────────────────────────────────

static void test_absent_fields_retain_their_previous_values() {
    // The whole point of patch semantics: bump a take number without
    // resending the scene description.
    Txn t; t.reset();

    stage(t, 2, "SC 14");
    stage(t, 3, "T 01");
    const char* first[MAX_FIELDS] = { nullptr, nullptr, "SC 14", "T 01",
                                      nullptr, nullptr, nullptr, nullptr };
    t.commit(make_commit(0x0C, crc_for(first, 0x0C), 1), false, true);

    // Second transaction touches field 3 only.
    stage(t, 3, "T 02");
    const char* second[MAX_FIELDS] = { nullptr, nullptr, nullptr, "T 02",
                                       nullptr, nullptr, nullptr, nullptr };
    const auto r = t.commit(make_commit(0x08, crc_for(second, 0x08), 2), false, true);

    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, r.outcome);
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));   // untouched
    TEST_ASSERT_EQUAL_STRING("T 02",  t.value(3));   // updated
    TEST_ASSERT_EQUAL_HEX8(0x08, r.changed_mask);
}

static void test_staged_but_unmasked_fields_are_discarded() {
    // §8.3: "A chunk for a field not named in the subsequent CLAP_COMMIT
    // mask is discarded." Applying it would let a stray frame from an
    // abandoned transaction leak into the next one.
    Txn t; t.reset();
    stage(t, 1, "GHOST");
    stage(t, 2, "SC 14");

    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    t.commit(make_commit(0x04, crc_for(vals, 0x04), 1), false, true);

    TEST_ASSERT_EQUAL_STRING("",      t.value(1));
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

// ── Rejections leave state untouched ──────────────────────────────────────

static void test_crc_mismatch_leaves_prior_values_untouched() {
    // A failed transaction must not half-apply. Half a slate is worse than
    // a stale one: the operator has no way to tell which fields are current.
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const char* good[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    t.commit(make_commit(0x04, crc_for(good, 0x04), 1), false, true);

    stage(t, 2, "SC 99");
    const auto r = t.commit(make_commit(0x04, 0xDEAD, 2), false, true);

    TEST_ASSERT_EQUAL(can_frames::Outcome::CrcMismatch, r.outcome);
    TEST_ASSERT_FALSE(r.apply);
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

static void test_masked_field_with_no_chunks_is_incomplete() {
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    // Mask names fields 2 AND 3, but only 2 was staged.
    const auto r = t.commit(make_commit(0x0C, 0x0000, 1), false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Incomplete, r.outcome);
    TEST_ASSERT_FALSE(r.apply);
    TEST_ASSERT_EQUAL_STRING("", t.value(2));
}

static void test_busy_is_reported_and_does_not_close_the_transaction() {
    // BUSY is transient. The sender retries with the SAME txn_id, which
    // must be treated as a fresh attempt — if BUSY were recorded as the
    // outcome, the idempotent-replay path would answer BUSY forever.
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    const auto cm = make_commit(0x04, crc_for(vals, 0x04), 5);

    const auto busy = t.commit(cm, /*renderer_busy=*/true, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Busy, busy.outcome);
    TEST_ASSERT_FALSE(busy.apply);

    const auto retry = t.commit(cm, /*renderer_busy=*/false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, retry.outcome);
    TEST_ASSERT_TRUE(retry.apply);
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

static void test_missing_template_is_rejected() {
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const auto r = t.commit(make_commit(0x04, 0, 1), false, /*template=*/false);
    TEST_ASSERT_EQUAL(can_frames::Outcome::NoTemplate, r.outcome);
    TEST_ASSERT_FALSE(r.apply);
}

static void test_a_rejected_transaction_does_not_contaminate_the_next() {
    Txn t; t.reset();
    stage(t, 1, "JUNK");
    t.commit(make_commit(0x02, 0xBAD1, 1), false, true);   // CRC fail

    // Next transaction names field 2 only. Field 1's staged junk must be
    // gone, not lurking.
    stage(t, 2, "SC 14");
    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    const auto r = t.commit(make_commit(0x04, crc_for(vals, 0x04), 2), false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, r.outcome);
    TEST_ASSERT_EQUAL_STRING("",      t.value(1));
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

// ── Idempotency ───────────────────────────────────────────────────────────

static void test_replayed_commit_reacks_without_reapplying() {
    // A lost CLAP_ACK is the one retry the sender is allowed. Without this,
    // the replay finds staging cleared and answers INCOMPLETE — telling ROS2
    // a transaction failed when the panel is in fact showing it.
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    const auto cm = make_commit(0x04, crc_for(vals, 0x04), 42);

    const auto first = t.commit(cm, false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, first.outcome);
    TEST_ASSERT_TRUE(first.apply);

    const auto replay = t.commit(cm, false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, replay.outcome);
    TEST_ASSERT_FALSE(replay.apply);          // no second render
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

static void test_replay_of_a_rejection_reports_the_same_rejection() {
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const auto cm = make_commit(0x04, 0xDEAD, 7);

    TEST_ASSERT_EQUAL(can_frames::Outcome::CrcMismatch, t.commit(cm, false, true).outcome);
    TEST_ASSERT_EQUAL(can_frames::Outcome::CrcMismatch, t.commit(cm, false, true).outcome);
}

// ── Link-drop safety ──────────────────────────────────────────────────────

static void test_abandon_staging_prevents_cross_shot_contamination() {
    // Chunks staged before a link drop must not complete against a commit
    // sent after it returns — that mixes two shots' data into one slate,
    // which is the worst failure this device can have.
    Txn t; t.reset();
    stage(t, 2, "OLD SHOT");
    t.abandon_staging();

    stage(t, 3, "T 01");
    const auto r = t.commit(make_commit(0x0C, 0, 1), false, true);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Incomplete, r.outcome);
    TEST_ASSERT_EQUAL_STRING("", t.value(2));
}

static void test_abandon_staging_keeps_committed_values() {
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    t.commit(make_commit(0x04, crc_for(vals, 0x04), 1), false, true);

    t.abandon_staging();
    TEST_ASSERT_EQUAL_STRING("SC 14", t.value(2));
}

// ── Firmware-set values ───────────────────────────────────────────────────

static void test_set_value_does_not_disturb_replay_detection() {
    // The date autofill must not make a legitimate replay look like a new
    // transaction, nor vice versa.
    Txn t; t.reset();
    stage(t, 2, "SC 14");
    const char* vals[MAX_FIELDS] = { nullptr, nullptr, "SC 14", nullptr,
                                     nullptr, nullptr, nullptr, nullptr };
    const auto cm = make_commit(0x04, crc_for(vals, 0x04), 9);
    t.commit(cm, false, true);

    t.set_value(0, "2026-08-16");
    TEST_ASSERT_EQUAL_STRING("2026-08-16", t.value(0));

    const auto replay = t.commit(cm, false, true);
    TEST_ASSERT_FALSE(replay.apply);
    TEST_ASSERT_EQUAL(can_frames::Outcome::Ok, replay.outcome);
}

static void test_set_value_truncates_at_the_field_limit() {
    Txn t; t.reset();
    const std::string over(MAX_CHARS + 10, 'Z');
    t.set_value(1, over.c_str());
    TEST_ASSERT_EQUAL_UINT32(MAX_CHARS, strlen(t.value(1)));
}

static void test_out_of_range_field_id_is_ignored_not_crashing() {
    Txn t; t.reset();
    t.set_value(MAX_FIELDS, "nope");
    TEST_ASSERT_EQUAL_STRING("", t.value(MAX_FIELDS));
}

// ── Mode arbitration (protocol.md §8.5) ───────────────────────────────────

static mode_state::Inputs healthy() {
    mode_state::Inputs in{};
    in.link_seen     = true;
    in.ros2_up       = true;
    in.ms_since_link = 100;
    in.time_synced   = true;
    return in;
}

static void test_mode_truth_table() {
    using mode_state::Mode;

    // Healthy → scene. Every other row → screensaver.
    TEST_ASSERT_EQUAL(Mode::Scene, mode_state::resolve(healthy()));

    mode_state::Inputs boot = healthy();
    boot.link_seen = false;
    TEST_ASSERT_EQUAL(Mode::Screensaver, mode_state::resolve(boot));

    mode_state::Inputs down = healthy();
    down.ros2_up = false;
    TEST_ASSERT_EQUAL(Mode::Screensaver, mode_state::resolve(down));

    mode_state::Inputs stale = healthy();
    stale.ms_since_link = mode_state::LINK_STALE_MS + 1;
    TEST_ASSERT_EQUAL(Mode::Screensaver, mode_state::resolve(stale));

    mode_state::Inputs unsynced = healthy();
    unsynced.time_synced = false;
    TEST_ASSERT_EQUAL(Mode::Screensaver, mode_state::resolve(unsynced));
}

static void test_link_staleness_boundary_is_inclusive() {
    mode_state::Inputs at = healthy();
    at.ms_since_link = mode_state::LINK_STALE_MS;
    TEST_ASSERT_EQUAL(mode_state::Mode::Scene, mode_state::resolve(at));

    at.ms_since_link = mode_state::LINK_STALE_MS + 1;
    TEST_ASSERT_EQUAL(mode_state::Mode::Screensaver, mode_state::resolve(at));
}

static void test_dead_teensy_shows_screensaver_not_the_last_scene() {
    // THE test that distinguishes this design from a push-only one. Nobody
    // sends "ROS2 down" when the bridge itself dies, so only staleness
    // catches it — and a push-only design would leave the healthiest-looking
    // state on the panel during the severest failure.
    mode_state::Inputs dead = healthy();
    dead.ros2_up       = true;                              // last thing we heard
    dead.ms_since_link = mode_state::LINK_STALE_MS + 5000;  // ...a while ago
    TEST_ASSERT_EQUAL(mode_state::Mode::Screensaver, mode_state::resolve(dead));
}

static void test_tracker_reports_the_first_resolve_as_a_change() {
    // Entry actions must run once at boot, not only on the first flip.
    mode_state::Tracker tr;
    mode_state::Inputs boot{};
    const auto s = tr.update(boot);
    TEST_ASSERT_TRUE(s.changed);
    TEST_ASSERT_EQUAL(mode_state::Mode::Screensaver, s.mode);

    const auto again = tr.update(boot);
    TEST_ASSERT_FALSE(again.changed);
}

static void test_tracker_flags_only_transitions() {
    mode_state::Tracker tr;
    tr.update(healthy());                                  // primes, changed
    TEST_ASSERT_FALSE(tr.update(healthy()).changed);

    mode_state::Inputs down = healthy();
    down.ros2_up = false;
    const auto to_ss = tr.update(down);
    TEST_ASSERT_TRUE(to_ss.changed);
    TEST_ASSERT_EQUAL(mode_state::Mode::Screensaver, to_ss.mode);
    TEST_ASSERT_FALSE(tr.update(down).changed);

    const auto back = tr.update(healthy());
    TEST_ASSERT_TRUE(back.changed);
    TEST_ASSERT_EQUAL(mode_state::Mode::Scene, back.mode);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_single_field_applies);
    RUN_TEST(test_chunks_may_arrive_in_any_order);
    RUN_TEST(test_max_length_field_survives_intact);
    RUN_TEST(test_absent_fields_retain_their_previous_values);
    RUN_TEST(test_staged_but_unmasked_fields_are_discarded);
    RUN_TEST(test_crc_mismatch_leaves_prior_values_untouched);
    RUN_TEST(test_masked_field_with_no_chunks_is_incomplete);
    RUN_TEST(test_busy_is_reported_and_does_not_close_the_transaction);
    RUN_TEST(test_missing_template_is_rejected);
    RUN_TEST(test_a_rejected_transaction_does_not_contaminate_the_next);
    RUN_TEST(test_replayed_commit_reacks_without_reapplying);
    RUN_TEST(test_replay_of_a_rejection_reports_the_same_rejection);
    RUN_TEST(test_abandon_staging_prevents_cross_shot_contamination);
    RUN_TEST(test_abandon_staging_keeps_committed_values);
    RUN_TEST(test_set_value_does_not_disturb_replay_detection);
    RUN_TEST(test_set_value_truncates_at_the_field_limit);
    RUN_TEST(test_out_of_range_field_id_is_ignored_not_crashing);
    RUN_TEST(test_mode_truth_table);
    RUN_TEST(test_link_staleness_boundary_is_inclusive);
    RUN_TEST(test_dead_teensy_shows_screensaver_not_the_last_scene);
    RUN_TEST(test_tracker_reports_the_first_resolve_as_a_change);
    RUN_TEST(test_tracker_flags_only_transitions);
    return UNITY_END();
}
