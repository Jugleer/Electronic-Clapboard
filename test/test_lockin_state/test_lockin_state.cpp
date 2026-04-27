// Native unit tests for the deferred-lockin state machine.
//
// The state machine drives the `?full=1` two-pass render: the
// synchronous all-white pass schedules the lockin; loop()'s
// frame::service() polls until the settle window elapses, runs the
// partial-content pass, then finalize()s. Getting the transitions
// wrong silently desaturates the panel or strands g_busy, so the
// state machine is extracted from frame.cpp and unit-tested here.

#include <unity.h>
#include "lockin_state.h"

using lockin::Action;
using lockin::SETTLE_MS;
using lockin::State;
using lockin::StateMachine;

void setUp() {}
void tearDown() {}

// --- Initial state ----------------------------------------------------------

static void test_initial_state_is_idle() {
    StateMachine sm;
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle),
                      static_cast<int>(sm.state()));
}

static void test_poll_when_idle_returns_wait() {
    StateMachine sm;
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(0)));
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(1'000'000)));
}

static void test_combined_render_ms_when_idle_is_zero() {
    StateMachine sm;
    TEST_ASSERT_EQUAL_UINT32(0, sm.combined_render_ms());
}

// --- schedule() -> Pending --------------------------------------------------

static void test_schedule_transitions_to_pending() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Pending),
                      static_cast<int>(sm.state()));
}

static void test_schedule_records_white_ms_and_timestamp() {
    StateMachine sm;
    sm.schedule(42'000, 3700);
    TEST_ASSERT_EQUAL_UINT32(3700, sm.white_ms());
    TEST_ASSERT_EQUAL_UINT32(42'000, sm.scheduled_at_ms());
}

// --- poll() while Pending ---------------------------------------------------

static void test_poll_before_settle_returns_wait() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(1000)));
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(1000 + SETTLE_MS - 1)));
}

static void test_poll_at_settle_boundary_returns_run_lockin() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::RunLockin),
                      static_cast<int>(sm.poll(1000 + SETTLE_MS)));
}

static void test_poll_after_settle_returns_run_lockin() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::RunLockin),
                      static_cast<int>(sm.poll(1000 + SETTLE_MS + 500)));
}

static void test_poll_is_idempotent_no_state_change() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.poll(1000 + SETTLE_MS);
    sm.poll(1000 + SETTLE_MS + 100);
    sm.poll(1000 + SETTLE_MS + 200);
    // Still pending; only finalize() can transition out.
    TEST_ASSERT_EQUAL(static_cast<int>(State::Pending),
                      static_cast<int>(sm.state()));
}

// --- finalize() -> Idle -----------------------------------------------------

static void test_finalize_transitions_to_idle() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.finalize(1500);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle),
                      static_cast<int>(sm.state()));
}

static void test_finalize_records_partial_ms() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.finalize(1500);
    TEST_ASSERT_EQUAL_UINT32(1500, sm.last_partial_ms());
}

static void test_combined_render_ms_after_finalize() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.finalize(1500);
    TEST_ASSERT_EQUAL_UINT32(5000, sm.combined_render_ms());
}

static void test_combined_render_ms_zero_while_pending() {
    // Critical contract: /status only sees the combined timing AFTER
    // the lockin has actually run. Reading mid-pending must return 0.
    StateMachine sm;
    sm.schedule(1000, 3500);
    TEST_ASSERT_EQUAL_UINT32(0, sm.combined_render_ms());
}

static void test_poll_after_finalize_returns_wait() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.finalize(1500);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(99'999)));
}

// --- Re-scheduling ----------------------------------------------------------

static void test_reschedule_after_finalize_resets_timing() {
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.finalize(1500);
    sm.schedule(10'000, 3800);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Pending),
                      static_cast<int>(sm.state()));
    TEST_ASSERT_EQUAL_UINT32(3800, sm.white_ms());
    TEST_ASSERT_EQUAL_UINT32(10'000, sm.scheduled_at_ms());
    // A second poll-then-finalize records the new partial timing.
    TEST_ASSERT_EQUAL(static_cast<int>(Action::RunLockin),
                      static_cast<int>(sm.poll(10'000 + SETTLE_MS)));
    sm.finalize(1700);
    TEST_ASSERT_EQUAL_UINT32(5500, sm.combined_render_ms());
}

static void test_reschedule_while_pending_replaces_state() {
    // Documents the intended (single-flight) behaviour: a second
    // schedule() while still Pending overwrites the prior schedule.
    // In production this never happens because g_busy gates concurrent
    // requests, but the state machine itself shouldn't lock up if it
    // does — it should just track the latest schedule.
    StateMachine sm;
    sm.schedule(1000, 3500);
    sm.schedule(2000, 3700);
    TEST_ASSERT_EQUAL_UINT32(3700, sm.white_ms());
    TEST_ASSERT_EQUAL_UINT32(2000, sm.scheduled_at_ms());
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(2000)));
    TEST_ASSERT_EQUAL(static_cast<int>(Action::RunLockin),
                      static_cast<int>(sm.poll(2000 + SETTLE_MS)));
}

// --- millis() rollover safety ----------------------------------------------

static void test_settle_check_is_unsigned_subtraction() {
    // millis() rolls over at ~49.7 days. The state machine uses
    // unsigned subtraction so a rollover during the SETTLE_MS window
    // computes the correct positive elapsed time. Simulate by
    // scheduling near UINT32_MAX and polling after wrap.
    StateMachine sm;
    const uint32_t near_max = 0xFFFFFF00u;
    sm.schedule(near_max, 3500);
    // Before settle: now is still pre-rollover.
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(near_max + 50)));
    // After rollover, but only +SETTLE_MS-1 elapsed — still wait.
    const uint32_t just_before = near_max + (SETTLE_MS - 1);  // wraps
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Wait),
                      static_cast<int>(sm.poll(just_before)));
    // +SETTLE_MS elapsed across the rollover — run.
    const uint32_t at_boundary = near_max + SETTLE_MS;  // wraps
    TEST_ASSERT_EQUAL(static_cast<int>(Action::RunLockin),
                      static_cast<int>(sm.poll(at_boundary)));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_initial_state_is_idle);
    RUN_TEST(test_poll_when_idle_returns_wait);
    RUN_TEST(test_combined_render_ms_when_idle_is_zero);
    RUN_TEST(test_schedule_transitions_to_pending);
    RUN_TEST(test_schedule_records_white_ms_and_timestamp);
    RUN_TEST(test_poll_before_settle_returns_wait);
    RUN_TEST(test_poll_at_settle_boundary_returns_run_lockin);
    RUN_TEST(test_poll_after_settle_returns_run_lockin);
    RUN_TEST(test_poll_is_idempotent_no_state_change);
    RUN_TEST(test_finalize_transitions_to_idle);
    RUN_TEST(test_finalize_records_partial_ms);
    RUN_TEST(test_combined_render_ms_after_finalize);
    RUN_TEST(test_combined_render_ms_zero_while_pending);
    RUN_TEST(test_poll_after_finalize_returns_wait);
    RUN_TEST(test_reschedule_after_finalize_resets_timing);
    RUN_TEST(test_reschedule_while_pending_replaces_state);
    RUN_TEST(test_settle_check_is_unsigned_subtraction);
    return UNITY_END();
}
