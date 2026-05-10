// Native unit tests for the screensaver-cycle state machine.
//
// The state machine resolves which slot the next timer-wake should
// render and reports the running picker mode (which may diverge from
// the configured one when wallclock_hybrid falls back). Pure logic,
// no Arduino dependency — mirrors test_fire_state / test_lockin_state
// shape. Bench gates S1, S2, S4, S6, S7 cover the on-device behaviour
// this layer abstracts.

#include <unity.h>

#include "screensaver_state.h"

using screensaver_state::OccupiedSlots;
using screensaver_state::PickerMode;
using screensaver_state::SchedulerInputs;
using screensaver_state::StateMachine;

namespace {

// Match the firmware-side bounds from protocol.md §2.6.
constexpr uint32_t MIN_INTERVAL_S =        60;
constexpr uint32_t MAX_INTERVAL_S =    604800;
constexpr uint32_t DEF_INTERVAL_S =       300;

OccupiedSlots none() { return OccupiedSlots{}; }

OccupiedSlots single(uint8_t slot) {
    OccupiedSlots s;
    s.add(slot);
    return s;
}

OccupiedSlots sparse() {
    // {0, 2, 5, 9, 12} — five slots, none adjacent past slot 0.
    OccupiedSlots s;
    s.add(0);
    s.add(2);
    s.add(5);
    s.add(9);
    s.add(12);
    return s;
}

}  // namespace

void setUp() {}
void tearDown() {}

// --- Initial state ---------------------------------------------------------

static void test_default_disabled_no_pick() {
    StateMachine sm;
    TEST_ASSERT_FALSE(sm.is_enabled());
    TEST_ASSERT_EQUAL(static_cast<int>(PickerMode::RoundRobin),
                      static_cast<int>(sm.picker_mode()));
    TEST_ASSERT_EQUAL(static_cast<int>(PickerMode::RoundRobin),
                      static_cast<int>(sm.picker_mode_actual(/*rtc_synced=*/false)));
    TEST_ASSERT_EQUAL_UINT32(DEF_INTERVAL_S, sm.cycle_interval_s());
    // Disabled: no current_slot.
    TEST_ASSERT_FALSE(sm.current_slot().has_value());
}

// --- Enable gating ---------------------------------------------------------

static void test_enable_with_no_slots_force_disables() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = DEF_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = none();
    sm.apply_config(in);
    // protocol §2.6: enabling with empty slots silently keeps disabled.
    TEST_ASSERT_FALSE(sm.is_enabled());
    TEST_ASSERT_FALSE(sm.current_slot().has_value());
}

static void test_enable_with_one_slot() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = DEF_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(7);
    sm.apply_config(in);
    TEST_ASSERT_TRUE(sm.is_enabled());
    TEST_ASSERT_TRUE(sm.current_slot().has_value());
    TEST_ASSERT_EQUAL_UINT8(7, sm.current_slot().value());
}

// --- Round-robin cadence ---------------------------------------------------

static void test_round_robin_single_slot_always_picks_it() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    sm.apply_config(in);

    for (int i = 0; i < 10; i++) {
        sm.advance_round_robin(/*rtc_synced=*/false, /*unix_seconds=*/0);
        TEST_ASSERT_EQUAL_UINT8(0, sm.current_slot().value());
    }
}

static void test_round_robin_iterates_only_occupied_slots() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = sparse();  // {0, 2, 5, 9, 12}
    sm.apply_config(in);

    // After apply_config the slot is the first occupied entry.
    TEST_ASSERT_EQUAL_UINT8(0, sm.current_slot().value());

    const uint8_t expected[] = {2, 5, 9, 12, 0, 2, 5, 9, 12, 0};
    for (size_t i = 0; i < sizeof(expected) / sizeof(expected[0]); i++) {
        sm.advance_round_robin(/*rtc_synced=*/false, /*unix_seconds=*/0);
        TEST_ASSERT_EQUAL_UINT8(expected[i], sm.current_slot().value());
    }
}

static void test_round_robin_counter_persists_across_apply_config() {
    // Restoring config from NVS on boot must not reset the counter.
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = sparse();
    sm.apply_config(in);  // current = 0

    sm.advance_round_robin(false, 0);  // current = 2
    sm.advance_round_robin(false, 0);  // current = 5

    // Simulate boot reload: restore the counter, then re-apply config.
    StateMachine sm2;
    sm2.restore_round_robin_counter(sm.round_robin_counter());
    sm2.apply_config(in);
    TEST_ASSERT_EQUAL_UINT8(5, sm2.current_slot().value());
}

// --- Mid-cycle deletion ----------------------------------------------------

static void test_delete_mid_cycle_skips_gone_slot() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = sparse();  // {0, 2, 5, 9, 12}
    sm.apply_config(in);

    sm.advance_round_robin(false, 0);  // current = 2
    TEST_ASSERT_EQUAL_UINT8(2, sm.current_slot().value());

    // User deletes slot 5 mid-cycle.
    OccupiedSlots reduced;
    reduced.add(0);
    reduced.add(2);
    reduced.add(9);
    reduced.add(12);
    in.occupied = reduced;
    sm.apply_config(in);

    // Next tick should skip the now-missing slot 5 entirely.
    sm.advance_round_robin(false, 0);
    TEST_ASSERT_EQUAL_UINT8(9, sm.current_slot().value());
}

static void test_delete_all_slots_force_disables_running_cycle() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(3);
    sm.apply_config(in);
    TEST_ASSERT_TRUE(sm.is_enabled());

    in.occupied = none();
    sm.apply_config(in);
    TEST_ASSERT_FALSE(sm.is_enabled());
    TEST_ASSERT_FALSE(sm.current_slot().has_value());
}

// --- Wallclock-hybrid ------------------------------------------------------

static void test_wallclock_hybrid_falls_back_when_unsynced() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::WallclockHybrid;
    in.occupied         = sparse();
    sm.apply_config(in);

    // Configured = WallclockHybrid; running = RoundRobin until anchored.
    TEST_ASSERT_EQUAL(static_cast<int>(PickerMode::WallclockHybrid),
                      static_cast<int>(sm.picker_mode()));
    TEST_ASSERT_EQUAL(static_cast<int>(PickerMode::RoundRobin),
                      static_cast<int>(sm.picker_mode_actual(/*rtc_synced=*/false)));

    // Behaviour matches round-robin while unsynced.
    TEST_ASSERT_EQUAL_UINT8(0, sm.current_slot().value());
    sm.advance(/*rtc_synced=*/false, /*unix_seconds=*/0);
    TEST_ASSERT_EQUAL_UINT8(2, sm.current_slot().value());
}

static void test_wallclock_hybrid_picks_by_unix_seconds_when_synced() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = 60;  // 60 s windows
    in.picker_mode      = PickerMode::WallclockHybrid;
    in.occupied         = sparse();  // 5 occupied: {0, 2, 5, 9, 12}
    sm.apply_config(in);

    // (unix / 60) mod 5 — the result is the index *into the occupied
    // list*, not the slot number directly. Map it back to the slot.
    const uint8_t occupied_list[] = {0, 2, 5, 9, 12};

    const uint64_t cases[] = {
        // unix_s, expected_index_into_occupied
        0,        // 0/60 mod 5 = 0 → slot 0
        59,       // same window → slot 0
        60,       // next window → slot 2 (idx=1)
        180,      // idx=3 → slot 9
        420,      // 7 mod 5 = 2 → slot 5
    };
    const uint8_t expected[] = {0, 0, 2, 9, 5};

    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        sm.advance(/*rtc_synced=*/true, cases[i]);
        TEST_ASSERT_EQUAL_UINT8(expected[i], sm.current_slot().value());
    }
    (void) occupied_list;
}

static void test_wallclock_hybrid_stable_across_same_window() {
    // Two consecutive ticks inside the same 60-s window must pick the
    // same slot — the cross-device sync property hinges on this.
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = 60;
    in.picker_mode      = PickerMode::WallclockHybrid;
    in.occupied         = sparse();
    sm.apply_config(in);

    sm.advance(/*rtc_synced=*/true, /*unix_seconds=*/12345);
    const uint8_t a = sm.current_slot().value();
    sm.advance(/*rtc_synced=*/true, /*unix_seconds=*/12345 + 30);
    const uint8_t b = sm.current_slot().value();
    TEST_ASSERT_EQUAL_UINT8(a, b);
}

static void test_wallclock_hybrid_round_robin_counter_untouched() {
    // While running in wallclock_hybrid, the round-robin NVS counter
    // must not advance — otherwise a fall-back to RR (e.g. after a
    // power cycle) would jump arbitrarily.
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = 60;
    in.picker_mode      = PickerMode::WallclockHybrid;
    in.occupied         = sparse();
    sm.apply_config(in);

    const uint32_t before = sm.round_robin_counter();
    sm.advance(/*rtc_synced=*/true, /*unix_seconds=*/12345);
    sm.advance(/*rtc_synced=*/true, /*unix_seconds=*/12405);
    sm.advance(/*rtc_synced=*/true, /*unix_seconds=*/12465);
    TEST_ASSERT_EQUAL_UINT32(before, sm.round_robin_counter());
}

// --- Cycle-interval bounds -------------------------------------------------

static void test_cycle_interval_clamped_to_min() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = 30;  // below min
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    const auto verdict = sm.validate_config(in);
    TEST_ASSERT_EQUAL(static_cast<int>(screensaver_state::ConfigVerdict::BadInterval),
                      static_cast<int>(verdict));
}

static void test_cycle_interval_clamped_to_max() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MAX_INTERVAL_S + 1;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    const auto verdict = sm.validate_config(in);
    TEST_ASSERT_EQUAL(static_cast<int>(screensaver_state::ConfigVerdict::BadInterval),
                      static_cast<int>(verdict));
}

static void test_cycle_interval_at_min_accepted() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    const auto verdict = sm.validate_config(in);
    TEST_ASSERT_EQUAL(static_cast<int>(screensaver_state::ConfigVerdict::Ok),
                      static_cast<int>(verdict));
}

static void test_cycle_interval_at_max_accepted() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MAX_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    const auto verdict = sm.validate_config(in);
    TEST_ASSERT_EQUAL(static_cast<int>(screensaver_state::ConfigVerdict::Ok),
                      static_cast<int>(verdict));
}

// --- next_tick_ms scheduling -----------------------------------------------

static void test_next_tick_ms_after_apply() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    sm.apply_config(in);

    sm.note_tick(/*now_ms=*/1000);
    const uint64_t next = sm.next_tick_ms();
    TEST_ASSERT_EQUAL_UINT64(1000 + (uint64_t) MIN_INTERVAL_S * 1000, next);
}

static void test_next_tick_ms_handles_millis_rollover() {
    // last_tick_ms near uint32 max; next-tick computation must not
    // truncate or wrap incorrectly. State machine tracks ticks in
    // uint64 to sidestep the wrap entirely.
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    sm.apply_config(in);

    const uint32_t near_max = 0xFFFFFE00u;
    sm.note_tick(near_max);
    const uint64_t next = sm.next_tick_ms();
    TEST_ASSERT_EQUAL_UINT64((uint64_t) near_max + (uint64_t) MIN_INTERVAL_S * 1000,
                             next);
}

static void test_next_tick_ms_null_until_first_tick() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    sm.apply_config(in);

    TEST_ASSERT_FALSE(sm.last_tick_ms().has_value());
    TEST_ASSERT_FALSE(sm.next_tick_ms_optional().has_value());
}

// --- Pause / resume across awake sessions ----------------------------------

static void test_pause_inhibits_next_tick() {
    StateMachine sm;
    SchedulerInputs in;
    in.enabled          = true;
    in.cycle_interval_s = MIN_INTERVAL_S;
    in.picker_mode      = PickerMode::RoundRobin;
    in.occupied         = single(0);
    sm.apply_config(in);

    sm.pause();
    TEST_ASSERT_FALSE(sm.next_tick_ms_optional().has_value());
    TEST_ASSERT_TRUE(sm.is_enabled());  // configured-enabled stays true

    sm.resume();
    sm.note_tick(/*now_ms=*/500);
    TEST_ASSERT_TRUE(sm.next_tick_ms_optional().has_value());
}

// ---------------------------------------------------------------------------

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_default_disabled_no_pick);
    RUN_TEST(test_enable_with_no_slots_force_disables);
    RUN_TEST(test_enable_with_one_slot);
    RUN_TEST(test_round_robin_single_slot_always_picks_it);
    RUN_TEST(test_round_robin_iterates_only_occupied_slots);
    RUN_TEST(test_round_robin_counter_persists_across_apply_config);
    RUN_TEST(test_delete_mid_cycle_skips_gone_slot);
    RUN_TEST(test_delete_all_slots_force_disables_running_cycle);
    RUN_TEST(test_wallclock_hybrid_falls_back_when_unsynced);
    RUN_TEST(test_wallclock_hybrid_picks_by_unix_seconds_when_synced);
    RUN_TEST(test_wallclock_hybrid_stable_across_same_window);
    RUN_TEST(test_wallclock_hybrid_round_robin_counter_untouched);
    RUN_TEST(test_cycle_interval_clamped_to_min);
    RUN_TEST(test_cycle_interval_clamped_to_max);
    RUN_TEST(test_cycle_interval_at_min_accepted);
    RUN_TEST(test_cycle_interval_at_max_accepted);
    RUN_TEST(test_next_tick_ms_after_apply);
    RUN_TEST(test_next_tick_ms_handles_millis_rollover);
    RUN_TEST(test_next_tick_ms_null_until_first_tick);
    RUN_TEST(test_pause_inhibits_next_tick);
    return UNITY_END();
}
