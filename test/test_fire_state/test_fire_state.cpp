// Native unit tests for the fire (sync) button state machine.
//
// The state machine drives Phase 9's physical fire button: a debounced
// press transitions Idle → Firing → CoolDown → Idle, accepts the next
// press only after MIN_FIRE_GAP_MS since the previous fire, and refuses
// silently while battery is low. The pure logic lives in
// src/fire_state.h; Arduino-side gate driving + watchdog ISR live in
// src/fire.cpp and are exercised on-bench.

#include <unity.h>

#include "fire_state.h"

using fire_state::Action;
using fire_state::State;
using fire_state::StateMachine;

namespace {
// Match the firmware-side defaults for the test suite. The state
// machine is parameterised on these so production code can use the
// values from include/config.h without dragging Arduino in here.
constexpr uint32_t TEST_PULSE_MS   = 60;
constexpr uint32_t TEST_MIN_GAP_MS = 1500;
}  // namespace

void setUp() {}
void tearDown() {}

// --- Initial state ----------------------------------------------------------

static void test_initial_state_is_idle() {
    StateMachine sm;
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle), static_cast<int>(sm.state()));
    TEST_ASSERT_EQUAL_UINT32(0, sm.fires_since_boot());
    TEST_ASSERT_FALSE(sm.has_fired());
    TEST_ASSERT_TRUE(sm.is_fire_ready(/*low_battery=*/false));
    TEST_ASSERT_FALSE(sm.is_fire_ready(/*low_battery=*/true));
}

static void test_first_sample_no_press_no_fire() {
    StateMachine sm;
    Action a = sm.sample(0, /*pressed=*/false, /*low_battery=*/false,
                         TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::None), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(0, sm.fires_since_boot());
}

// --- Rising-edge fires exactly once ----------------------------------------

static void test_rising_edge_fires_exactly_once() {
    StateMachine sm;
    // Frame 1: not pressed.
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    // Frame 2: now pressed (rising edge) — should fire.
    Action a = sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(1, sm.fires_since_boot());
    TEST_ASSERT_TRUE(sm.has_fired());
    TEST_ASSERT_EQUAL_UINT32(10, sm.last_fire_at_ms());
    TEST_ASSERT_EQUAL(static_cast<int>(State::Firing), static_cast<int>(sm.state()));
}

static void test_held_press_does_not_re_fire() {
    // A held button must not retrigger — only the rising edge counts.
    StateMachine sm;
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    Action first = sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(first));
    // Continued hold across many ticks — still no re-fire, even after
    // the cooldown window has elapsed.
    for (uint32_t t = 11; t < 5000; t += 50) {
        Action a = sm.sample(t, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
        TEST_ASSERT_EQUAL(static_cast<int>(Action::None), static_cast<int>(a));
    }
    TEST_ASSERT_EQUAL_UINT32(1, sm.fires_since_boot());
}

// --- Cooldown gate ---------------------------------------------------------

static void test_press_during_cooldown_silently_ignored() {
    StateMachine sm;
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);  // fire
    sm.sample(11, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS); // release

    // 500 ms later (still inside the 1500 ms cooldown), press again.
    Action ignored = sm.sample(510, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::None), static_cast<int>(ignored));
    TEST_ASSERT_EQUAL_UINT32(1, sm.fires_since_boot());
    TEST_ASSERT_FALSE(sm.is_fire_ready(false));
}

static void test_press_after_cooldown_accepts() {
    StateMachine sm;
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);  // fire @ 10
    sm.sample(11, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS); // release

    // Tick through pulse end and cooldown end, button released.
    sm.sample(80, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);   // pulse done -> CoolDown
    TEST_ASSERT_EQUAL(static_cast<int>(State::CoolDown), static_cast<int>(sm.state()));
    sm.sample(1500, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS); // 10 + 1500 — Idle now
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle), static_cast<int>(sm.state()));
    TEST_ASSERT_TRUE(sm.is_fire_ready(false));

    // Press again — accepted.
    Action a = sm.sample(1600, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(2, sm.fires_since_boot());
    TEST_ASSERT_EQUAL_UINT32(1600, sm.last_fire_at_ms());
}

static void test_state_transitions_through_pulse_and_gap() {
    StateMachine sm;
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Firing), static_cast<int>(sm.state()));
    // Mid-pulse: still Firing.
    sm.sample(50, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Firing), static_cast<int>(sm.state()));
    // Just after pulse: CoolDown.
    sm.sample(70, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(State::CoolDown), static_cast<int>(sm.state()));
    // Just before gap end: still CoolDown.
    sm.sample(1509, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(State::CoolDown), static_cast<int>(sm.state()));
    // At gap end: Idle.
    sm.sample(1510, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle), static_cast<int>(sm.state()));
}

// --- Low-battery refuse ----------------------------------------------------

static void test_low_battery_blocks_fire() {
    StateMachine sm;
    sm.sample(0, false, true, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    Action a = sm.sample(10, true, /*low_battery=*/true,
                         TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::None), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(0, sm.fires_since_boot());
    TEST_ASSERT_FALSE(sm.has_fired());
    TEST_ASSERT_FALSE(sm.is_fire_ready(true));
    TEST_ASSERT_TRUE(sm.is_fire_ready(false));  // would be ready if battery recovered
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle), static_cast<int>(sm.state()));
}

static void test_battery_recovers_then_press_fires() {
    StateMachine sm;
    // Press while low — refused.
    sm.sample(0, false, true, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, true, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL_UINT32(0, sm.fires_since_boot());
    // Release.
    sm.sample(20, false, true, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    // Battery recovers, press again — accepted.
    sm.sample(30, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    Action a = sm.sample(40, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(1, sm.fires_since_boot());
}

// --- millis() rollover -----------------------------------------------------

static void test_cooldown_works_across_millis_rollover() {
    StateMachine sm;
    const uint32_t near_max = 0xFFFFFE00u;  // 0xFFFFFFFF - 0x1FF
    sm.sample(near_max, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    Action first = sm.sample(near_max + 10, true, false,
                             TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(first));
    sm.sample(near_max + 20, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);

    // Press 500 ms later, across the wrap point — must still be ignored.
    Action ignored = sm.sample(near_max + 510, true, false,
                               TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::None), static_cast<int>(ignored));

    // Release and then press 1500 ms after the fire — should be accepted
    // even though now_ms has wrapped past zero.
    sm.sample(near_max + 520, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    const uint32_t after_wrap = (uint32_t)(near_max + 10 + 1600);
    sm.sample(after_wrap - 10, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    Action a = sm.sample(after_wrap, true, false,
                         TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(2, sm.fires_since_boot());
}

// --- reset() (Phase 8 wake / cold boot) ------------------------------------

static void test_reset_clears_state_and_counter() {
    StateMachine sm;
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL_UINT32(1, sm.fires_since_boot());

    sm.reset();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle), static_cast<int>(sm.state()));
    TEST_ASSERT_EQUAL_UINT32(0, sm.fires_since_boot());
    TEST_ASSERT_EQUAL_UINT32(0, sm.last_fire_at_ms());
    TEST_ASSERT_FALSE(sm.has_fired());
    TEST_ASSERT_TRUE(sm.is_fire_ready(false));

    // After reset, a fresh press fires immediately — cooldown does not
    // survive reset (matches the post-wake behaviour documented in
    // protocol.md §2.5).
    sm.sample(20, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    Action a = sm.sample(30, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(a));
    TEST_ASSERT_EQUAL_UINT32(1, sm.fires_since_boot());
    TEST_ASSERT_EQUAL_UINT32(30, sm.last_fire_at_ms());
}

// --- is_fire_ready surfaces all gates --------------------------------------

static void test_is_fire_ready_reflects_state_and_battery() {
    StateMachine sm;
    TEST_ASSERT_TRUE(sm.is_fire_ready(false));   // Idle, healthy
    TEST_ASSERT_FALSE(sm.is_fire_ready(true));   // Idle, low battery

    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);  // -> Firing
    TEST_ASSERT_FALSE(sm.is_fire_ready(false));  // Firing
    TEST_ASSERT_FALSE(sm.is_fire_ready(true));

    sm.sample(80, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS); // -> CoolDown
    TEST_ASSERT_FALSE(sm.is_fire_ready(false));  // CoolDown
    TEST_ASSERT_FALSE(sm.is_fire_ready(true));

    sm.sample(1510, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS); // -> Idle
    TEST_ASSERT_TRUE(sm.is_fire_ready(false));
    TEST_ASSERT_FALSE(sm.is_fire_ready(true));
}

// --- Edge-case: press exactly at cooldown boundary -------------------------

static void test_press_exactly_at_gap_boundary_accepts() {
    // The boundary belongs to "ready" — `>=` not `>` in the implementation.
    StateMachine sm;
    sm.sample(0, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    sm.sample(10, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);  // fire @ 10
    sm.sample(11, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);

    // Tick to exactly the boundary: 10 + 1500 = 1510.
    sm.sample(1510, false, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Idle), static_cast<int>(sm.state()));
    Action a = sm.sample(1511, true, false, TEST_PULSE_MS, TEST_MIN_GAP_MS);
    TEST_ASSERT_EQUAL(static_cast<int>(Action::Fire), static_cast<int>(a));
}

// ---------------------------------------------------------------------------

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_initial_state_is_idle);
    RUN_TEST(test_first_sample_no_press_no_fire);
    RUN_TEST(test_rising_edge_fires_exactly_once);
    RUN_TEST(test_held_press_does_not_re_fire);
    RUN_TEST(test_press_during_cooldown_silently_ignored);
    RUN_TEST(test_press_after_cooldown_accepts);
    RUN_TEST(test_state_transitions_through_pulse_and_gap);
    RUN_TEST(test_low_battery_blocks_fire);
    RUN_TEST(test_battery_recovers_then_press_fires);
    RUN_TEST(test_cooldown_works_across_millis_rollover);
    RUN_TEST(test_reset_clears_state_and_counter);
    RUN_TEST(test_is_fire_ready_reflects_state_and_battery);
    RUN_TEST(test_press_exactly_at_gap_boundary_accepts);
    return UNITY_END();
}
