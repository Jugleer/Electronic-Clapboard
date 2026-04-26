// Native unit tests for the /status JSON builder.
//
// Builder is pure C++ (no Arduino.h, no WiFi). Tests assert the field
// shape locked in docs/protocol.md §2.2 — most importantly that the four
// `last_frame_*` fields serialise as JSON `null` (not `0` and not absent)
// before any frame has been received.

#include <unity.h>
#include <string>
#include "status_json.h"

void setUp() {}
void tearDown() {}

static bool contains(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}

// ---------------------------------------------------------------------------
// Inputs with no last-frame metadata (firmware just booted, never POSTed to).
// ---------------------------------------------------------------------------
static StatusInputs fresh_boot_inputs() {
    StatusInputs in{};
    in.firmware_version = "0.1.0";
    in.uptime_ms        = 12345;
    in.free_heap        = 213456;
    in.psram_free       = 8000000;
    in.last_frame       = {}; // std::nullopt — never received a frame
    return in;
}

// ---------------------------------------------------------------------------
// Inputs with last-frame metadata populated.
// ---------------------------------------------------------------------------
static StatusInputs after_frame_inputs() {
    StatusInputs in{};
    in.firmware_version = "1.2.3";
    in.uptime_ms        = 123456;
    in.free_heap        = 200000;
    in.psram_free       = 7900000;
    LastFrameMeta lf{};
    lf.at_ms          = 122000;
    lf.bytes          = 48000;
    lf.render_ms      = 1432;
    lf.full_refresh   = false;
    in.last_frame = lf;
    return in;
}

// --- Top-level shape -------------------------------------------------------

static void test_starts_with_object_brace() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE_MESSAGE(!s.empty() && s.front() == '{',
                             "JSON must start with '{'");
    TEST_ASSERT_TRUE_MESSAGE(s.back() == '}',
                             "JSON must end with '}'");
}

static void test_single_line_no_control_chars() {
    const auto s = build_status_json(fresh_boot_inputs());
    for (char c : s) {
        TEST_ASSERT_TRUE_MESSAGE(c != '\n' && c != '\r' && c != '\t',
                                 "single-line JSON: no \\n/\\r/\\t");
    }
}

static void test_ok_true_present() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"ok\":true"));
}

// --- firmware_version ------------------------------------------------------

static void test_firmware_version_is_quoted_string() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"firmware_version\":\"0.1.0\""));
}

static void test_firmware_version_changes_with_input() {
    const auto s = build_status_json(after_frame_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"firmware_version\":\"1.2.3\""));
}

// --- numeric fields are bare integers (no quotes) --------------------------

static void test_uptime_is_bare_number() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"uptime_ms\":12345"));
    TEST_ASSERT_FALSE_MESSAGE(contains(s, "\"uptime_ms\":\"12345\""),
                              "uptime_ms must not be quoted");
}

static void test_free_heap_is_bare_number() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"free_heap\":213456"));
}

static void test_psram_free_is_bare_number_even_when_zero() {
    StatusInputs in = fresh_boot_inputs();
    in.psram_free = 0;
    const auto s = build_status_json(in);
    TEST_ASSERT_TRUE_MESSAGE(contains(s, "\"psram_free\":0"),
                             "psram_free=0 must serialise as 0, not omitted");
}

// --- last_frame_* fields: JSON null before first frame ---------------------

static void test_last_frame_at_null_when_no_frame() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE_MESSAGE(contains(s, "\"last_frame_at\":null"),
                             "last_frame_at must be JSON null pre-first-frame");
    TEST_ASSERT_FALSE_MESSAGE(contains(s, "\"last_frame_at\":0"),
                              "last_frame_at must NOT be 0 pre-first-frame");
}

static void test_last_frame_bytes_null_when_no_frame() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_bytes\":null"));
    TEST_ASSERT_FALSE(contains(s, "\"last_frame_bytes\":0"));
}

static void test_last_frame_render_ms_null_when_no_frame() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_render_ms\":null"));
    TEST_ASSERT_FALSE(contains(s, "\"last_frame_render_ms\":0"));
}

static void test_last_full_refresh_null_when_no_frame() {
    const auto s = build_status_json(fresh_boot_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"last_full_refresh\":null"));
    TEST_ASSERT_FALSE_MESSAGE(contains(s, "\"last_full_refresh\":false"),
                              "pre-frame must be null, not false");
}

// --- last_frame_* fields: populated values after a frame -------------------

static void test_last_frame_populated_values() {
    const auto s = build_status_json(after_frame_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_at\":122000"));
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_bytes\":48000"));
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_render_ms\":1432"));
    TEST_ASSERT_TRUE(contains(s, "\"last_full_refresh\":false"));
}

static void test_last_full_refresh_true_serialises_as_true() {
    StatusInputs in = after_frame_inputs();
    LastFrameMeta lf = *in.last_frame;
    lf.full_refresh = true;
    in.last_frame = lf;
    const auto s = build_status_json(in);
    TEST_ASSERT_TRUE(contains(s, "\"last_full_refresh\":true"));
}

// --- All locked field names from protocol.md §2.2 are present --------------

static void test_all_locked_fields_present() {
    const auto s = build_status_json(after_frame_inputs());
    TEST_ASSERT_TRUE(contains(s, "\"ok\""));
    TEST_ASSERT_TRUE(contains(s, "\"firmware_version\""));
    TEST_ASSERT_TRUE(contains(s, "\"uptime_ms\""));
    TEST_ASSERT_TRUE(contains(s, "\"free_heap\""));
    TEST_ASSERT_TRUE(contains(s, "\"psram_free\""));
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_at\""));
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_bytes\""));
    TEST_ASSERT_TRUE(contains(s, "\"last_frame_render_ms\""));
    TEST_ASSERT_TRUE(contains(s, "\"last_full_refresh\""));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_starts_with_object_brace);
    RUN_TEST(test_single_line_no_control_chars);
    RUN_TEST(test_ok_true_present);
    RUN_TEST(test_firmware_version_is_quoted_string);
    RUN_TEST(test_firmware_version_changes_with_input);
    RUN_TEST(test_uptime_is_bare_number);
    RUN_TEST(test_free_heap_is_bare_number);
    RUN_TEST(test_psram_free_is_bare_number_even_when_zero);
    RUN_TEST(test_last_frame_at_null_when_no_frame);
    RUN_TEST(test_last_frame_bytes_null_when_no_frame);
    RUN_TEST(test_last_frame_render_ms_null_when_no_frame);
    RUN_TEST(test_last_full_refresh_null_when_no_frame);
    RUN_TEST(test_last_frame_populated_values);
    RUN_TEST(test_last_full_refresh_true_serialises_as_true);
    RUN_TEST(test_all_locked_fields_present);
    return UNITY_END();
}
