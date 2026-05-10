// Native unit tests for /screensaver/manifest JSON serialiser.
//
// Locks the field names + null/value discipline from protocol.md §2.6.
// Mirrors test_status_json shape: a substring-search style that pins
// the wire shape without depending on a JSON parser in the test rig.

#include <unity.h>
#include <string>

#include "screensaver_manifest.h"

using screensaver_manifest::ManifestInputs;
using screensaver_manifest::SlotInfo;
using screensaver_state::PickerMode;

void setUp() {}
void tearDown() {}

static bool contains(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}

static ManifestInputs fresh_inputs() {
    ManifestInputs in{};
    in.enabled              = false;
    in.cycle_interval_s     = 300;
    in.min_cycle_interval_s = 60;
    in.max_cycle_interval_s = 604800;
    in.max_slots            = 50;
    in.picker_mode          = PickerMode::RoundRobin;
    in.picker_mode_actual   = PickerMode::RoundRobin;
    in.rtc_synced           = false;
    in.current_slot         = std::nullopt;
    in.last_tick_ms         = std::nullopt;
    in.next_tick_ms         = std::nullopt;
    return in;
}

// --- Top-level shape ---------------------------------------------------

static void test_starts_with_object_brace() {
    const auto s = build_manifest_json(fresh_inputs());
    TEST_ASSERT_TRUE(!s.empty() && s.front() == '{');
    TEST_ASSERT_TRUE(s.back() == '}');
}

static void test_single_line_no_control_chars() {
    const auto s = build_manifest_json(fresh_inputs());
    for (char c : s) {
        TEST_ASSERT_TRUE_MESSAGE(c != '\n' && c != '\r' && c != '\t',
                                 "single-line JSON: no \\n/\\r/\\t");
    }
}

static void test_ok_true_present() {
    const auto s = build_manifest_json(fresh_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"ok\":true"));
}

// --- Field names locked --------------------------------------------------

static void test_all_locked_fields_present() {
    auto in = fresh_inputs();
    in.enabled              = true;
    in.current_slot         = uint8_t{3};
    in.last_tick_ms         = uint64_t{100000};
    in.next_tick_ms         = uint64_t{160000};
    in.rtc_synced           = true;
    in.slots.push_back({3, "studio-blue", 48000, 12345});

    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"ok\""));
    TEST_ASSERT_TRUE(contains(s, "\"enabled\""));
    TEST_ASSERT_TRUE(contains(s, "\"cycle_interval_s\""));
    TEST_ASSERT_TRUE(contains(s, "\"min_cycle_interval_s\""));
    TEST_ASSERT_TRUE(contains(s, "\"max_cycle_interval_s\""));
    TEST_ASSERT_TRUE(contains(s, "\"max_slots\""));
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode\""));
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode_actual\""));
    TEST_ASSERT_TRUE(contains(s, "\"rtc_synced\""));
    TEST_ASSERT_TRUE(contains(s, "\"current_slot\""));
    TEST_ASSERT_TRUE(contains(s, "\"last_tick_ms\""));
    TEST_ASSERT_TRUE(contains(s, "\"next_tick_ms\""));
    TEST_ASSERT_TRUE(contains(s, "\"slots\""));
}

// --- Picker-mode enum string mapping ------------------------------------

static void test_picker_mode_round_robin_string() {
    auto in = fresh_inputs();
    in.picker_mode        = PickerMode::RoundRobin;
    in.picker_mode_actual = PickerMode::RoundRobin;
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode\":\"round_robin\""));
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode_actual\":\"round_robin\""));
}

static void test_picker_mode_wallclock_hybrid_string() {
    auto in = fresh_inputs();
    in.picker_mode        = PickerMode::WallclockHybrid;
    in.picker_mode_actual = PickerMode::WallclockHybrid;
    in.rtc_synced         = true;
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode\":\"wallclock_hybrid\""));
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode_actual\":\"wallclock_hybrid\""));
}

static void test_picker_mode_actual_diverges_when_unsynced() {
    // The whole point of picker_mode_actual: configured-but-not-running.
    auto in = fresh_inputs();
    in.picker_mode        = PickerMode::WallclockHybrid;
    in.picker_mode_actual = PickerMode::RoundRobin;
    in.rtc_synced         = false;
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode\":\"wallclock_hybrid\""));
    TEST_ASSERT_TRUE(contains(s, "\"picker_mode_actual\":\"round_robin\""));
    TEST_ASSERT_TRUE(contains(s, "\"rtc_synced\":false"));
}

// --- Booleans serialise bare ---------------------------------------------

static void test_enabled_bool_bare() {
    auto in = fresh_inputs();
    in.enabled = true;
    auto t = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(t, "\"enabled\":true"));
    in.enabled = false;
    auto f = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(f, "\"enabled\":false"));
    TEST_ASSERT_FALSE(contains(f, "\"enabled\":\"false\""));
}

static void test_rtc_synced_bool_bare() {
    auto in = fresh_inputs();
    in.rtc_synced = true;
    auto t = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(t, "\"rtc_synced\":true"));
    in.rtc_synced = false;
    auto f = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(f, "\"rtc_synced\":false"));
}

// --- Numeric bounds in the body -----------------------------------------

static void test_bounds_emitted_as_bare_numbers() {
    const auto s = build_manifest_json(fresh_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"min_cycle_interval_s\":60"));
    TEST_ASSERT_TRUE(contains(s, "\"max_cycle_interval_s\":604800"));
    TEST_ASSERT_TRUE(contains(s, "\"max_slots\":50"));
    TEST_ASSERT_FALSE(contains(s, "\"max_slots\":\"50\""));
}

// --- current_slot / last_tick_ms / next_tick_ms null discipline ---------

static void test_current_slot_null_when_no_slots() {
    const auto s = build_manifest_json(fresh_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"current_slot\":null"));
    TEST_ASSERT_FALSE(contains(s, "\"current_slot\":0"));  // must be null, not 0
}

static void test_current_slot_populated_when_set() {
    auto in = fresh_inputs();
    in.current_slot = uint8_t{7};
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"current_slot\":7"));
    TEST_ASSERT_FALSE(contains(s, "\"current_slot\":null"));
}

static void test_last_tick_ms_null_until_first_tick() {
    const auto s = build_manifest_json(fresh_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"last_tick_ms\":null"));
    TEST_ASSERT_TRUE(contains(s, "\"next_tick_ms\":null"));
}

static void test_last_tick_ms_populated() {
    auto in = fresh_inputs();
    in.last_tick_ms = uint64_t{1234567};
    in.next_tick_ms = uint64_t{1294567};
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"last_tick_ms\":1234567"));
    TEST_ASSERT_TRUE(contains(s, "\"next_tick_ms\":1294567"));
}

// --- slots array structure ----------------------------------------------

static void test_slots_empty_array_when_no_slots() {
    const auto s = build_manifest_json(fresh_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"slots\":[]"));
}

static void test_slots_serialised_in_ascending_order() {
    auto in = fresh_inputs();
    // Caller is responsible for sort order; verify the serialiser
    // emits in input order without re-sorting (the firmware already
    // walks LittleFS in slot-index order).
    in.slots.push_back({0, "alpha",   48000, 100});
    in.slots.push_back({3, "bravo",   48000, 200});
    in.slots.push_back({12, "charlie", 48000, 300});
    const auto s = build_manifest_json(in);

    const auto p_alpha   = s.find("\"alpha\"");
    const auto p_bravo   = s.find("\"bravo\"");
    const auto p_charlie = s.find("\"charlie\"");
    TEST_ASSERT_NOT_EQUAL(std::string::npos, p_alpha);
    TEST_ASSERT_NOT_EQUAL(std::string::npos, p_bravo);
    TEST_ASSERT_NOT_EQUAL(std::string::npos, p_charlie);
    TEST_ASSERT_TRUE(p_alpha < p_bravo);
    TEST_ASSERT_TRUE(p_bravo < p_charlie);

    TEST_ASSERT_TRUE(contains(s, "\"slot\":0"));
    TEST_ASSERT_TRUE(contains(s, "\"slot\":3"));
    TEST_ASSERT_TRUE(contains(s, "\"slot\":12"));
}

static void test_slot_object_field_names() {
    auto in = fresh_inputs();
    in.slots.push_back({3, "studio-blue", 48000, 12345});
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"slot\":3"));
    TEST_ASSERT_TRUE(contains(s, "\"name\":\"studio-blue\""));
    TEST_ASSERT_TRUE(contains(s, "\"bytes\":48000"));
    TEST_ASSERT_TRUE(contains(s, "\"updated_at_ms\":12345"));
}

static void test_slot_name_escapes_quotes_and_backslashes() {
    // Names round-trip through HTTP query strings up to 32 chars; the
    // firmware decodes percent-encoded UTF-8 into the manifest. The
    // serialiser must JSON-escape inner quotes/backslashes/newlines so
    // a hostile or weird name doesn't break the body.
    auto in = fresh_inputs();
    in.slots.push_back({0, "weird\"name\\here", 48000, 1});
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\\\"name\\\""));
    TEST_ASSERT_TRUE(contains(s, "\\\\here"));
}

// --- Disabled-with-slots: enabled false but slots populated -----------

static void test_disabled_with_slots_round_trip() {
    // The "enable+empty" fold-down lives in the state machine; the
    // serialiser just emits whatever it's given. Verify both the
    // enabled flag and the slots array independently render.
    auto in = fresh_inputs();
    in.enabled = false;
    in.slots.push_back({0, "alpha", 48000, 100});
    const auto s = build_manifest_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"enabled\":false"));
    TEST_ASSERT_TRUE(contains(s, "\"slot\":0"));
}

// ---------------------------------------------------------------------------

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_starts_with_object_brace);
    RUN_TEST(test_single_line_no_control_chars);
    RUN_TEST(test_ok_true_present);
    RUN_TEST(test_all_locked_fields_present);
    RUN_TEST(test_picker_mode_round_robin_string);
    RUN_TEST(test_picker_mode_wallclock_hybrid_string);
    RUN_TEST(test_picker_mode_actual_diverges_when_unsynced);
    RUN_TEST(test_enabled_bool_bare);
    RUN_TEST(test_rtc_synced_bool_bare);
    RUN_TEST(test_bounds_emitted_as_bare_numbers);
    RUN_TEST(test_current_slot_null_when_no_slots);
    RUN_TEST(test_current_slot_populated_when_set);
    RUN_TEST(test_last_tick_ms_null_until_first_tick);
    RUN_TEST(test_last_tick_ms_populated);
    RUN_TEST(test_slots_empty_array_when_no_slots);
    RUN_TEST(test_slots_serialised_in_ascending_order);
    RUN_TEST(test_slot_object_field_names);
    RUN_TEST(test_slot_name_escapes_quotes_and_backslashes);
    RUN_TEST(test_disabled_with_slots_round_trip);
    return UNITY_END();
}
