// Phase 15: template upload wire-format tests for src/template_wire.h.
//
// The format is a contract between the browser editor and the firmware, and
// unlike the CAN contract it has no third implementation to cross-check
// against — so the byte offsets are asserted literally here rather than
// round-tripped only. A round-trip test passes happily if both sides of the
// codec drift together.

#include <unity.h>

#include <cstring>

#include "template_wire.h"

using namespace template_wire;

void setUp() {}
void tearDown() {}

namespace {

region::Region make_region(uint8_t field_id = 0) {
    region::Region r{};
    r.field_id = field_id;
    r.x = 16; r.y = 60; r.w = 380; r.h = 150;
    r.font   = region::FontId::SansBold24x2;
    r.halign = text_fit::HAlign::Right;
    r.valign = text_fit::VAlign::Bottom;
    r.invert = true;
    return r;
}

region::Template make_template(uint8_t count = 2) {
    region::Template t{};
    t.id = 3;
    t.region_count = count;
    for (uint8_t i = 0; i < count; ++i) {
        t.regions[i] = make_region(i);
        t.regions[i].y = (int16_t)(10 + i * 50);
        t.regions[i].h = 40;
    }
    return t;
}

}  // namespace

// ── Sizes are the contract ────────────────────────────────────────────────

static void test_wire_sizes_are_pinned() {
    // These numbers appear in the editor's exporter and in the firmware's
    // Content-Length check. If one moves without the other, uploads fail
    // with a length error that says nothing about why.
    TEST_ASSERT_EQUAL_UINT32(48000, RASTER_BYTES);
    TEST_ASSERT_EQUAL_UINT8(12,     REGION_BYTES);
    TEST_ASSERT_EQUAL_UINT8(100,    TRAILER_BYTES);
    TEST_ASSERT_EQUAL_UINT32(48100, BODY_BYTES);
}

// ── Region record layout ──────────────────────────────────────────────────

static void test_region_byte_layout() {
    const region::Region r = make_region(5);
    uint8_t d[REGION_BYTES];
    memset(d, 0xAA, sizeof(d));
    encode_region(r, d);

    TEST_ASSERT_EQUAL_HEX8(5,    d[0]);          // field_id
    TEST_ASSERT_EQUAL_HEX8(16,   d[1]);          // x = 16, LE
    TEST_ASSERT_EQUAL_HEX8(0,    d[2]);
    TEST_ASSERT_EQUAL_HEX8(60,   d[3]);          // y = 60
    TEST_ASSERT_EQUAL_HEX8(0,    d[4]);
    TEST_ASSERT_EQUAL_HEX8(0x7C, d[5]);          // w = 380 = 0x017C
    TEST_ASSERT_EQUAL_HEX8(0x01, d[6]);
    TEST_ASSERT_EQUAL_HEX8(0x96, d[7]);          // h = 150 = 0x0096
    TEST_ASSERT_EQUAL_HEX8(0x00, d[8]);
    TEST_ASSERT_EQUAL_HEX8(5,    d[9]);          // FontId::SansBold24x2
    // flags: halign Right(2) | valign Bottom(2)<<2 | invert 0x10 = 0x1A
    TEST_ASSERT_EQUAL_HEX8(0x1A, d[10]);
    TEST_ASSERT_EQUAL_HEX8(0,    d[11]);         // reserved must be zeroed
}

static void test_region_round_trip() {
    const region::Region in = make_region(7);
    uint8_t d[REGION_BYTES];
    encode_region(in, d);

    region::Region out{};
    decode_region(d, out);

    TEST_ASSERT_EQUAL_UINT8(in.field_id, out.field_id);
    TEST_ASSERT_EQUAL_INT16(in.x, out.x);
    TEST_ASSERT_EQUAL_INT16(in.y, out.y);
    TEST_ASSERT_EQUAL_UINT16(in.w, out.w);
    TEST_ASSERT_EQUAL_UINT16(in.h, out.h);
    TEST_ASSERT_EQUAL_UINT8((uint8_t) in.font,   (uint8_t) out.font);
    TEST_ASSERT_EQUAL_UINT8((uint8_t) in.halign, (uint8_t) out.halign);
    TEST_ASSERT_EQUAL_UINT8((uint8_t) in.valign, (uint8_t) out.valign);
    TEST_ASSERT_TRUE(out.invert);
}

static void test_all_alignment_combinations_survive_the_flag_byte() {
    // halign and valign share one byte with the invert bit. Packing bugs
    // here are the kind that only show on one of nine combinations.
    for (uint8_t h = 0; h < 3; ++h) {
        for (uint8_t v = 0; v < 3; ++v) {
            for (uint8_t inv = 0; inv < 2; ++inv) {
                region::Region in = make_region();
                in.halign = (text_fit::HAlign) h;
                in.valign = (text_fit::VAlign) v;
                in.invert = (inv != 0);

                uint8_t d[REGION_BYTES];
                encode_region(in, d);
                region::Region out{};
                decode_region(d, out);

                TEST_ASSERT_EQUAL_UINT8(h, (uint8_t) out.halign);
                TEST_ASSERT_EQUAL_UINT8(v, (uint8_t) out.valign);
                TEST_ASSERT_EQUAL_UINT8(inv != 0, out.invert);
            }
        }
    }
}

// ── Trailer ───────────────────────────────────────────────────────────────

static void test_trailer_header_layout() {
    const region::Template t = make_template(3);
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);

    TEST_ASSERT_EQUAL_HEX8('T', trailer[0]);   // MAGIC 0x4C54 little-endian
    TEST_ASSERT_EQUAL_HEX8('L', trailer[1]);
    TEST_ASSERT_EQUAL_HEX8(1,   trailer[2]);   // VERSION
    TEST_ASSERT_EQUAL_HEX8(3,   trailer[3]);   // region_count
}

static void test_unused_slots_are_zero_filled() {
    // Zero-filling keeps the body byte-stable for a given template, so two
    // uploads of the same design are diffable and the fixed length is
    // honest rather than "fixed length, arbitrary tail".
    const region::Template t = make_template(2);
    uint8_t trailer[TRAILER_BYTES];
    memset(trailer, 0xAA, sizeof(trailer));
    encode_trailer(t, trailer);

    for (uint32_t i = TRAILER_HEADER + 2 * REGION_BYTES; i < TRAILER_BYTES; ++i) {
        TEST_ASSERT_EQUAL_HEX8(0, trailer[i]);
    }
}

static void test_trailer_round_trip() {
    const region::Template in = make_template(4);
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(in, trailer);

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::Ok, parse_trailer(trailer, 3, out));
    TEST_ASSERT_EQUAL_UINT8(3, out.id);          // id comes from the caller, not the wire
    TEST_ASSERT_EQUAL_UINT8(4, out.region_count);
    for (uint8_t i = 0; i < 4; ++i) {
        TEST_ASSERT_EQUAL_UINT8(in.regions[i].field_id, out.regions[i].field_id);
        TEST_ASSERT_EQUAL_INT16(in.regions[i].y, out.regions[i].y);
    }
}

// ── Rejection paths ───────────────────────────────────────────────────────

static void test_bad_magic_rejected() {
    // Without the magic, the first 48,000 bytes of any /frame body would
    // parse as a raster and the next 100 as garbage regions — a mis-routed
    // POST would silently install a corrupt template.
    const region::Template t = make_template();
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);
    trailer[0] ^= 0xFF;

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::BadMagic, parse_trailer(trailer, 0, out));
}

static void test_bad_version_rejected() {
    const region::Template t = make_template();
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);
    trailer[2] = 99;

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::BadVersion, parse_trailer(trailer, 0, out));
}

static void test_region_count_over_max_rejected() {
    const region::Template t = make_template();
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);
    trailer[3] = region::MAX_REGIONS + 1;

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::BadCount, parse_trailer(trailer, 0, out));
}

static void test_out_of_bounds_region_rejected() {
    region::Template t = make_template(1);
    t.regions[0].x = 700;
    t.regions[0].w = 200;          // 900 > 800
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::InvalidRegion, parse_trailer(trailer, 0, out));
}

static void test_duplicate_field_ids_rejected() {
    region::Template t = make_template(2);
    t.regions[1].field_id = t.regions[0].field_id;
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::InvalidRegion, parse_trailer(trailer, 0, out));
}

static void test_rejected_parse_leaves_out_untouched() {
    // The caller's natural response to a rejection is to keep using whatever
    // was already loaded, so a partially-written `out` would be a silent
    // corruption of the live template.
    region::Template out{};
    out.id = 42;
    out.region_count = 7;

    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(make_template(), trailer);
    trailer[0] ^= 0xFF;   // bad magic

    TEST_ASSERT_EQUAL(ParseResult::BadMagic, parse_trailer(trailer, 0, out));
    TEST_ASSERT_EQUAL_UINT8(42, out.id);
    TEST_ASSERT_EQUAL_UINT8(7,  out.region_count);
}

static void test_zero_regions_is_valid() {
    // A background with no fields is a legitimate static slate.
    region::Template t{};
    t.id = 0;
    t.region_count = 0;
    uint8_t trailer[TRAILER_BYTES];
    encode_trailer(t, trailer);

    region::Template out{};
    TEST_ASSERT_EQUAL(ParseResult::Ok, parse_trailer(trailer, 0, out));
    TEST_ASSERT_EQUAL_UINT8(0, out.region_count);
}

static void test_max_templates_fits_the_partition() {
    // slate_data is 3.456 MB and the screensaver may claim 50 x 48,000 =
    // 2.4 MB of it. This asserts the template budget still leaves headroom;
    // raising MAX_TEMPLATES without checking is how a device starts failing
    // uploads with "partition full" months later.
    const uint32_t screensaver_worst = 50u * 48000u;
    const uint32_t templates_worst   = (uint32_t) MAX_TEMPLATES * BODY_BYTES;
    const uint32_t partition         = 0x360000;   // 3,538,944
    TEST_ASSERT_TRUE(screensaver_worst + templates_worst < partition * 9 / 10);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_wire_sizes_are_pinned);
    RUN_TEST(test_region_byte_layout);
    RUN_TEST(test_region_round_trip);
    RUN_TEST(test_all_alignment_combinations_survive_the_flag_byte);
    RUN_TEST(test_trailer_header_layout);
    RUN_TEST(test_unused_slots_are_zero_filled);
    RUN_TEST(test_trailer_round_trip);
    RUN_TEST(test_bad_magic_rejected);
    RUN_TEST(test_bad_version_rejected);
    RUN_TEST(test_region_count_over_max_rejected);
    RUN_TEST(test_out_of_bounds_region_rejected);
    RUN_TEST(test_duplicate_field_ids_rejected);
    RUN_TEST(test_rejected_parse_leaves_out_untouched);
    RUN_TEST(test_zero_regions_is_valid);
    RUN_TEST(test_max_templates_fits_the_partition);
    return UNITY_END();
}
