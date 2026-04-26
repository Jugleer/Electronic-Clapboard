// Native unit tests for the log ring buffer.
//
// The ring is the back-pressure boundary between firmware logging
// (synchronous, called from any task) and the TCP log stream (best-effort,
// rate-limited by the network). Drop-oldest policy: if the writer laps the
// reader, the oldest bytes are discarded silently and the loss count is
// surfaced to the next drain so a connected client knows it missed data.

#include <unity.h>
#include <cstring>
#include <string>
#include "log_ring.h"

void setUp() {}
void tearDown() {}

// ---------------------------------------------------------------------------
// Empty / single push.
// ---------------------------------------------------------------------------

static void test_empty_drain_returns_zero() {
    LogRing ring(64);
    auto cur = ring.make_cursor();
    char buf[64];
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(0, r.bytes_written);
    TEST_ASSERT_EQUAL(0, r.bytes_lost);
}

static void test_single_push_drains_once() {
    LogRing ring(64);
    auto cur = ring.make_cursor();
    ring.push("hello\n", 6);

    char buf[64] = {};
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(6, r.bytes_written);
    TEST_ASSERT_EQUAL(0, r.bytes_lost);
    TEST_ASSERT_EQUAL_STRING_LEN("hello\n", buf, 6);

    // Second drain on the same cursor returns nothing — cursor advanced.
    auto r2 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(0, r2.bytes_written);
    TEST_ASSERT_EQUAL(0, r2.bytes_lost);
}

// ---------------------------------------------------------------------------
// Multiple pushes interleaved with drains.
// ---------------------------------------------------------------------------

static void test_multiple_pushes_drain_in_order() {
    LogRing ring(64);
    auto cur = ring.make_cursor();
    ring.push("aa", 2);
    ring.push("bb", 2);
    ring.push("cc", 2);

    char buf[16] = {};
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(6, r.bytes_written);
    TEST_ASSERT_EQUAL_STRING_LEN("aabbcc", buf, 6);
}

static void test_drain_advances_cursor_between_pushes() {
    LogRing ring(64);
    auto cur = ring.make_cursor();

    ring.push("first ", 6);
    char buf[16] = {};
    ring.drain(cur, buf, sizeof(buf));

    ring.push("second", 6);
    std::memset(buf, 0, sizeof(buf));
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(6, r.bytes_written);
    TEST_ASSERT_EQUAL_STRING_LEN("second", buf, 6);
}

// ---------------------------------------------------------------------------
// Wraparound: writer wraps the physical buffer, reader keeps up.
// ---------------------------------------------------------------------------

static void test_wraparound_reader_keeps_up() {
    LogRing ring(8);
    auto cur = ring.make_cursor();

    // Push 6 bytes, drain immediately (reader keeps up; no loss).
    ring.push("AAAAAA", 6);
    char buf[16] = {};
    auto r1 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(6, r1.bytes_written);
    TEST_ASSERT_EQUAL(0, r1.bytes_lost);

    // Push 6 more — writer crosses the ring boundary but reader was caught up.
    ring.push("BBBBBB", 6);
    std::memset(buf, 0, sizeof(buf));
    auto r2 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(6, r2.bytes_written);
    TEST_ASSERT_EQUAL(0, r2.bytes_lost);
    TEST_ASSERT_EQUAL_STRING_LEN("BBBBBB", buf, 6);
}

// ---------------------------------------------------------------------------
// Lap: writer overruns the reader's cursor — old bytes lost, count surfaced.
// ---------------------------------------------------------------------------

static void test_lapped_reader_reports_loss_and_returns_newest() {
    LogRing ring(8);
    auto cur = ring.make_cursor();

    // Reader gets a cursor at index 0, then sleeps. Writer pushes 20 bytes;
    // ring holds only 8, so 12 bytes are overwritten before reader drains.
    ring.push("0123456789ABCDEFGHIJ", 20);

    char buf[16] = {};
    auto r = ring.drain(cur, buf, sizeof(buf));
    // Reader gets the latest 8 bytes, with 12 reported lost.
    TEST_ASSERT_EQUAL(8, r.bytes_written);
    TEST_ASSERT_EQUAL(12, r.bytes_lost);
    TEST_ASSERT_EQUAL_STRING_LEN("CDEFGHIJ", buf, 8);

    // After draining, cursor sits at the head; next drain is empty.
    auto r2 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(0, r2.bytes_written);
    TEST_ASSERT_EQUAL(0, r2.bytes_lost);
}

static void test_lapped_then_caught_up_no_further_loss() {
    LogRing ring(8);
    auto cur = ring.make_cursor();

    ring.push("0123456789ABCDEFGHIJ", 20);
    char buf[16] = {};
    ring.drain(cur, buf, sizeof(buf));  // catches up with loss

    ring.push("xyz", 3);
    std::memset(buf, 0, sizeof(buf));
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(3, r.bytes_written);
    TEST_ASSERT_EQUAL(0, r.bytes_lost);
    TEST_ASSERT_EQUAL_STRING_LEN("xyz", buf, 3);
}

// ---------------------------------------------------------------------------
// Partial drain: caller's buffer is smaller than the queued bytes.
// ---------------------------------------------------------------------------

static void test_partial_drain_returns_remainder_on_next_call() {
    LogRing ring(64);
    auto cur = ring.make_cursor();
    ring.push("abcdefghij", 10);

    char buf[4] = {};
    auto r1 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(4, r1.bytes_written);
    TEST_ASSERT_EQUAL_STRING_LEN("abcd", buf, 4);

    std::memset(buf, 0, sizeof(buf));
    auto r2 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(4, r2.bytes_written);
    TEST_ASSERT_EQUAL_STRING_LEN("efgh", buf, 4);

    std::memset(buf, 0, sizeof(buf));
    auto r3 = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(2, r3.bytes_written);
    TEST_ASSERT_EQUAL_STRING_LEN("ij", buf, 2);
}

// ---------------------------------------------------------------------------
// New cursor after pushes points at the current head — drain is empty.
// (A new TCP client should NOT see the entire historical ring on connect by
// default — the server explicitly chooses to replay or not.)
// ---------------------------------------------------------------------------

static void test_make_cursor_after_pushes_is_at_head() {
    LogRing ring(64);
    ring.push("history", 7);
    auto cur = ring.make_cursor();
    char buf[16] = {};
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(0, r.bytes_written);
    TEST_ASSERT_EQUAL(0, r.bytes_lost);
}

// ---------------------------------------------------------------------------
// Replay cursor: explicit "give me everything currently in the ring."
// ---------------------------------------------------------------------------

static void test_replay_cursor_returns_buffered_history() {
    LogRing ring(8);
    ring.push("hello", 5);
    auto cur = ring.make_replay_cursor();
    char buf[16] = {};
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(5, r.bytes_written);
    TEST_ASSERT_EQUAL_STRING_LEN("hello", buf, 5);
}

static void test_replay_cursor_caps_at_capacity_when_lapped() {
    LogRing ring(8);
    ring.push("0123456789ABCDEFGHIJ", 20);  // 20 bytes into 8-byte ring
    auto cur = ring.make_replay_cursor();
    char buf[16] = {};
    auto r = ring.drain(cur, buf, sizeof(buf));
    // Replay returns the last 8 bytes; no loss reported (we deliberately
    // started at the oldest available byte).
    TEST_ASSERT_EQUAL(8, r.bytes_written);
    TEST_ASSERT_EQUAL(0, r.bytes_lost);
    TEST_ASSERT_EQUAL_STRING_LEN("CDEFGHIJ", buf, 8);
}

// ---------------------------------------------------------------------------
// Push with len=0 / null is a no-op (defensive).
// ---------------------------------------------------------------------------

static void test_push_zero_length_is_noop() {
    LogRing ring(64);
    auto cur = ring.make_cursor();
    ring.push("", 0);
    char buf[16];
    auto r = ring.drain(cur, buf, sizeof(buf));
    TEST_ASSERT_EQUAL(0, r.bytes_written);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_empty_drain_returns_zero);
    RUN_TEST(test_single_push_drains_once);
    RUN_TEST(test_multiple_pushes_drain_in_order);
    RUN_TEST(test_drain_advances_cursor_between_pushes);
    RUN_TEST(test_wraparound_reader_keeps_up);
    RUN_TEST(test_lapped_reader_reports_loss_and_returns_newest);
    RUN_TEST(test_lapped_then_caught_up_no_further_loss);
    RUN_TEST(test_partial_drain_returns_remainder_on_next_call);
    RUN_TEST(test_make_cursor_after_pushes_is_at_head);
    RUN_TEST(test_replay_cursor_returns_buffered_history);
    RUN_TEST(test_replay_cursor_caps_at_capacity_when_lapped);
    RUN_TEST(test_push_zero_length_is_noop);
    return UNITY_END();
}
