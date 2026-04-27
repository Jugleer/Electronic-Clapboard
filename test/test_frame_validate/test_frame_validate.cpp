// Native unit tests for POST /frame request validation.
//
// All assertions trace back to the locked contract in
// docs/protocol.md §2.1: status codes, slugs, and the 48000-byte size.

#include <unity.h>
#include <string>
#include "frame_validate.h"

void setUp() {}
void tearDown() {}

// --- Content-Length ---------------------------------------------------------

static void test_content_length_exact_is_ok() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::Ok),
                      static_cast<int>(validate_content_length(48000)));
}

static void test_content_length_one_short_is_bad_size() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::BadSize),
                      static_cast<int>(validate_content_length(47999)));
}

static void test_content_length_one_long_is_too_large() {
    // Per protocol.md §2.1: any Content-Length > 48000 is rejected as 413.
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::TooLarge),
                      static_cast<int>(validate_content_length(48001)));
}

static void test_content_length_huge_is_too_large() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::TooLarge),
                      static_cast<int>(validate_content_length(1u << 20)));
}

static void test_content_length_zero_is_bad_size() {
    // No "length_required" slug is allocated; bad_size covers absent/0.
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::BadSize),
                      static_cast<int>(validate_content_length(0)));
}

// --- to_error() maps to locked HTTP statuses & slugs -----------------------

static void test_bad_size_maps_to_400() {
    auto e = to_error(FrameValidation::BadSize);
    TEST_ASSERT_EQUAL(400, e.http_status);
    TEST_ASSERT_EQUAL_STRING("bad_size", e.slug);
}

static void test_too_large_maps_to_413() {
    auto e = to_error(FrameValidation::TooLarge);
    TEST_ASSERT_EQUAL(413, e.http_status);
    TEST_ASSERT_EQUAL_STRING("too_large", e.slug);
}

static void test_bad_content_type_maps_to_415() {
    auto e = to_error(FrameValidation::BadContentType);
    TEST_ASSERT_EQUAL(415, e.http_status);
    TEST_ASSERT_EQUAL_STRING("bad_content_type", e.slug);
}

// --- Content-Type ----------------------------------------------------------

static void test_content_type_canonical_is_ok() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::Ok),
                      static_cast<int>(validate_content_type("application/octet-stream")));
}

static void test_content_type_with_params_is_ok() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::Ok),
                      static_cast<int>(validate_content_type(
                          "application/octet-stream; charset=binary")));
}

static void test_content_type_case_insensitive() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::Ok),
                      static_cast<int>(validate_content_type("Application/Octet-Stream")));
}

static void test_content_type_with_leading_whitespace_in_params_is_ok() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::Ok),
                      static_cast<int>(validate_content_type(
                          "  application/octet-stream  ;charset=binary")));
}

static void test_content_type_text_plain_is_rejected() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::BadContentType),
                      static_cast<int>(validate_content_type("text/plain")));
}

static void test_content_type_empty_is_rejected() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::BadContentType),
                      static_cast<int>(validate_content_type("")));
}

static void test_content_type_application_json_is_rejected() {
    TEST_ASSERT_EQUAL(static_cast<int>(FrameValidation::BadContentType),
                      static_cast<int>(validate_content_type("application/json")));
}

// --- ?full=1 query parsing -------------------------------------------------

static void test_full_query_one_is_true() {
    TEST_ASSERT_TRUE(parse_full_refresh_query("full=1"));
    TEST_ASSERT_TRUE(parse_full_refresh_query("?full=1"));
}

static void test_full_query_absent_is_false() {
    TEST_ASSERT_FALSE(parse_full_refresh_query(""));
    TEST_ASSERT_FALSE(parse_full_refresh_query("?"));
}

static void test_full_query_zero_is_false() {
    TEST_ASSERT_FALSE(parse_full_refresh_query("full=0"));
}

static void test_full_query_loose_truthy_is_false() {
    // Strict: only "full=1" counts. Avoids future ambiguity.
    TEST_ASSERT_FALSE(parse_full_refresh_query("full=true"));
    TEST_ASSERT_FALSE(parse_full_refresh_query("full=yes"));
    TEST_ASSERT_FALSE(parse_full_refresh_query("full"));
}

static void test_full_query_with_other_params() {
    TEST_ASSERT_TRUE(parse_full_refresh_query("debug=1&full=1"));
    TEST_ASSERT_TRUE(parse_full_refresh_query("full=1&debug=1"));
    TEST_ASSERT_FALSE(parse_full_refresh_query("debug=1&full=0"));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_content_length_exact_is_ok);
    RUN_TEST(test_content_length_one_short_is_bad_size);
    RUN_TEST(test_content_length_one_long_is_too_large);
    RUN_TEST(test_content_length_huge_is_too_large);
    RUN_TEST(test_content_length_zero_is_bad_size);
    RUN_TEST(test_bad_size_maps_to_400);
    RUN_TEST(test_too_large_maps_to_413);
    RUN_TEST(test_bad_content_type_maps_to_415);
    RUN_TEST(test_content_type_canonical_is_ok);
    RUN_TEST(test_content_type_with_params_is_ok);
    RUN_TEST(test_content_type_case_insensitive);
    RUN_TEST(test_content_type_with_leading_whitespace_in_params_is_ok);
    RUN_TEST(test_content_type_text_plain_is_rejected);
    RUN_TEST(test_content_type_empty_is_rejected);
    RUN_TEST(test_content_type_application_json_is_rejected);
    RUN_TEST(test_full_query_one_is_true);
    RUN_TEST(test_full_query_absent_is_false);
    RUN_TEST(test_full_query_zero_is_false);
    RUN_TEST(test_full_query_loose_truthy_is_false);
    RUN_TEST(test_full_query_with_other_params);
    return UNITY_END();
}
