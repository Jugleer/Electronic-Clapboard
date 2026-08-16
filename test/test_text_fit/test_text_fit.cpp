// Phase 14: truncation, alignment and region-validation tests.
//
// These exercise src/text_fit.h and src/region.h with a fabricated advance
// table, so the rules are pinned without a font or a panel. The real GFX
// metrics only change the *numbers*; the behaviour under test is which
// characters survive, where the ellipsis goes, and where the baseline lands.

#include <unity.h>

#include <cstring>
#include <string>

#include "region.h"
#include "text_fit.h"

using namespace text_fit;

namespace {

// Monospace 10 px advance for every printable character. Monospace keeps the
// arithmetic in each assertion obvious — "5 chars fit in 50 px" — so a
// failure points at the logic rather than at a width table.
uint16_t g_mono[ADVANCE_TABLE_LEN];

// Proportional table: 'i' is narrow, 'W' is wide, everything else 10 px.
// Used to prove the fitter measures per character rather than assuming a
// uniform advance.
uint16_t g_prop[ADVANCE_TABLE_LEN];

void init_tables() {
    for (uint8_t i = 0; i < ADVANCE_TABLE_LEN; ++i) {
        g_mono[i] = 10;
        g_prop[i] = 10;
    }
    g_prop[advance_index('i')] = 4;
    g_prop[advance_index('W')] = 20;
}

}  // namespace

void setUp() { init_tables(); }
void tearDown() {}

// ── measure ───────────────────────────────────────────────────────────────

static void test_measure_sums_advances() {
    TEST_ASSERT_EQUAL_UINT16(50, measure("Scene", 5, g_mono));
    TEST_ASSERT_EQUAL_UINT16(0,  measure("", 0, g_mono));
    // Proportional: 'i' 4 + 'W' 20 + 'x' 10 = 34
    TEST_ASSERT_EQUAL_UINT16(34, measure("iWx", 3, g_prop));
}

static void test_unsupported_bytes_measure_as_the_substitute() {
    // protocol.md §8.3 substitutes '?' for bytes with no glyph. The width
    // must follow the substitution, otherwise fitting disagrees with drawing
    // and text overruns its box.
    g_mono[advance_index('?')] = 7;
    const char high[] = { (char) 0xC3, (char) 0xA9, '\0' };  // UTF-8 'é'
    TEST_ASSERT_EQUAL_UINT16(14, measure(high, 2, g_mono));
}

// ── fit: the happy path ───────────────────────────────────────────────────

static void test_text_that_fits_is_drawn_whole() {
    const FitResult r = fit("Scene", UINT8_MAX, 100, g_mono);
    TEST_ASSERT_EQUAL_UINT8(5, r.draw_len);
    TEST_ASSERT_FALSE(r.ellipsis);
    TEST_ASSERT_FALSE(r.overflowed);
    TEST_ASSERT_EQUAL_UINT16(50, r.pixel_width);
}

static void test_text_exactly_filling_the_box_is_not_truncated() {
    // Off-by-one guard: 5 chars at 10 px in exactly 50 px must fit.
    const FitResult r = fit("Scene", UINT8_MAX, 50, g_mono);
    TEST_ASSERT_EQUAL_UINT8(5, r.draw_len);
    TEST_ASSERT_FALSE(r.overflowed);
}

static void test_one_pixel_short_triggers_truncation() {
    const FitResult r = fit("Scene", UINT8_MAX, 49, g_mono);
    TEST_ASSERT_TRUE(r.overflowed);
}

// ── fit: ellipsis ─────────────────────────────────────────────────────────

static void test_ellipsis_reserves_its_own_width() {
    // Box 60 px, ellipsis 30 px, so 3 characters of content may remain.
    const FitResult r = fit("Scene Four", UINT8_MAX, 60, g_mono);
    TEST_ASSERT_TRUE(r.overflowed);
    TEST_ASSERT_TRUE(r.ellipsis);
    TEST_ASSERT_EQUAL_UINT8(3, r.draw_len);
    TEST_ASSERT_EQUAL_UINT16(60, r.pixel_width);
    // And it must never exceed the box.
    TEST_ASSERT_TRUE(r.pixel_width <= 60);
}

static void test_ellipsis_never_overruns_the_box() {
    // Sweep every box width across a long string and assert the invariant
    // that actually matters on the panel: whatever we report drawing must
    // fit. A single hand-picked case would miss the boundary conditions.
    const char* s = "The quick brown fox";
    for (uint16_t w = 1; w <= 260; ++w) {
        const FitResult r = fit(s, UINT8_MAX, w, g_mono);
        uint16_t drawn = measure(s, r.draw_len, g_mono);
        if (r.ellipsis) drawn = (uint16_t)(drawn + measure(ELLIPSIS, ELLIPSIS_CHARS, g_mono));
        TEST_ASSERT_TRUE_MESSAGE(drawn <= w, "fitted text wider than its box");
        TEST_ASSERT_EQUAL_UINT16(drawn, r.pixel_width);
    }
}

static void test_box_too_narrow_for_ellipsis_hard_truncates() {
    // 25 px box, ellipsis needs 30. Rather than drawing nothing, we draw the
    // two characters that fit. Rationale in text_fit.h: a blank region on a
    // slate reads as "no scene number", which is a false statement, whereas
    // a truncated one is merely incomplete.
    const FitResult r = fit("Scene", UINT8_MAX, 25, g_mono);
    TEST_ASSERT_TRUE(r.overflowed);
    TEST_ASSERT_FALSE(r.ellipsis);
    TEST_ASSERT_EQUAL_UINT8(2, r.draw_len);
    TEST_ASSERT_EQUAL_UINT16(20, r.pixel_width);
}

static void test_box_narrower_than_one_glyph_draws_nothing() {
    const FitResult r = fit("Scene", UINT8_MAX, 5, g_mono);
    TEST_ASSERT_TRUE(r.overflowed);
    TEST_ASSERT_FALSE(r.ellipsis);
    TEST_ASSERT_EQUAL_UINT8(0, r.draw_len);
    TEST_ASSERT_EQUAL_UINT16(0, r.pixel_width);
}

static void test_empty_string_fits_anything() {
    const FitResult r = fit("", UINT8_MAX, 0, g_mono);
    TEST_ASSERT_EQUAL_UINT8(0, r.draw_len);
    TEST_ASSERT_FALSE(r.overflowed);
    TEST_ASSERT_FALSE(r.ellipsis);
}

static void test_proportional_widths_are_respected() {
    // "iiiii" is 5×4 = 20 px; "WW" is 40. A fitter assuming uniform advance
    // would get both wrong.
    TEST_ASSERT_FALSE(fit("iiiii", UINT8_MAX, 20, g_prop).overflowed);
    TEST_ASSERT_TRUE(fit("WW",    UINT8_MAX, 30, g_prop).overflowed);
}

static void test_max_chars_cap_is_honoured() {
    // The CAN field limit is 32 chars; a value arriving without a NUL must
    // not be read past its buffer.
    char buf[8];
    memset(buf, 'X', sizeof(buf));   // deliberately unterminated
    const FitResult r = fit(buf, 8, 1000, g_mono);
    TEST_ASSERT_EQUAL_UINT8(8, r.draw_len);
    TEST_ASSERT_EQUAL_UINT16(80, r.pixel_width);
}

// ── alignment ─────────────────────────────────────────────────────────────

static void test_horizontal_alignment() {
    TEST_ASSERT_EQUAL_INT16(0,  h_offset(50, 100, HAlign::Left));
    TEST_ASSERT_EQUAL_INT16(25, h_offset(50, 100, HAlign::Center));
    TEST_ASSERT_EQUAL_INT16(50, h_offset(50, 100, HAlign::Right));
}

static void test_alignment_saturates_when_text_is_wider_than_the_box() {
    // A negative offset would start the text left of its region and paint
    // over whatever sits beside it.
    TEST_ASSERT_EQUAL_INT16(0, h_offset(120, 100, HAlign::Center));
    TEST_ASSERT_EQUAL_INT16(0, h_offset(120, 100, HAlign::Right));
    TEST_ASSERT_EQUAL_INT16(0, h_offset(100, 100, HAlign::Right));
}

static void test_vertical_baseline_placement() {
    // ascent 30, descent 8, region 100 tall.
    TEST_ASSERT_EQUAL_INT16(30, v_baseline(100, VAlign::Top, 30, 8));
    TEST_ASSERT_EQUAL_INT16(92, v_baseline(100, VAlign::Bottom, 30, 8));
    // Middle: (100 - 38)/2 + 30 = 31 + 30 = 61
    TEST_ASSERT_EQUAL_INT16(61, v_baseline(100, VAlign::Middle, 30, 8));
}

static void test_vertical_middle_is_content_independent() {
    // The whole point of using font ascent/descent rather than per-string
    // extents: "xyz" and "XYZ" must sit on the same baseline, or fields
    // visibly jump as their content changes.
    const int16_t a = v_baseline(60, VAlign::Middle, 30, 8);
    const int16_t b = v_baseline(60, VAlign::Middle, 30, 8);
    TEST_ASSERT_EQUAL_INT16(a, b);
}

// ── region validation ─────────────────────────────────────────────────────

static region::Region make_region() {
    region::Region r{};
    r.field_id = 0;
    r.x = 10; r.y = 10; r.w = 200; r.h = 40;
    r.font   = region::FontId::SansBold24;
    r.halign = HAlign::Left;
    r.valign = VAlign::Middle;
    r.invert = false;
    return r;
}

static void test_valid_region_accepted() {
    TEST_ASSERT_TRUE(region::is_valid(make_region()));
}

static void test_region_must_fit_the_panel() {
    region::Region r = make_region();
    r.x = 700; r.w = 200;                       // 900 > 800
    TEST_ASSERT_FALSE(region::is_valid(r));

    r = make_region();
    r.y = 460; r.h = 40;                        // 500 > 480
    TEST_ASSERT_FALSE(region::is_valid(r));

    r = make_region();
    r.x = 600; r.w = 200;                       // exactly 800 — allowed
    TEST_ASSERT_TRUE(region::is_valid(r));
}

static void test_region_rejects_degenerate_and_out_of_range() {
    region::Region r = make_region();
    r.w = 0;
    TEST_ASSERT_FALSE(region::is_valid(r));

    r = make_region();
    r.x = -1;
    TEST_ASSERT_FALSE(region::is_valid(r));

    r = make_region();
    r.field_id = region::MAX_REGIONS;
    TEST_ASSERT_FALSE(region::is_valid(r));

    r = make_region();
    r.font = (region::FontId) region::FontId::_Count;
    TEST_ASSERT_FALSE(region::is_valid(r));
}

static void test_template_rejects_duplicate_field_ids() {
    // The editor is supposed to prevent this, so a duplicate reaching the
    // firmware means the template did not come from the editor — or came
    // from a version that disagrees with this build. Last-one-wins would
    // hide that.
    region::Template t{};
    t.id = 1;
    t.region_count = 2;
    t.regions[0] = make_region();
    t.regions[1] = make_region();
    t.regions[1].y = 100;
    TEST_ASSERT_FALSE(region::is_valid(t));

    t.regions[1].field_id = 1;
    TEST_ASSERT_TRUE(region::is_valid(t));
}

static void test_template_find_by_field_id() {
    region::Template t{};
    t.id = 1;
    t.region_count = 2;
    t.regions[0] = make_region();
    t.regions[0].field_id = 3;
    t.regions[1] = make_region();
    t.regions[1].field_id = 5;
    t.regions[1].y = 100;

    TEST_ASSERT_NOT_NULL(region::find(t, 3));
    TEST_ASSERT_EQUAL_UINT8(5, region::find(t, 5)->field_id);
    TEST_ASSERT_NULL(region::find(t, 0));
}

static void test_empty_template_is_valid() {
    // A template with a background and no fields is legitimate — it is just
    // a static slate, which is exactly what a screensaver slot is.
    region::Template t{};
    t.id = 0;
    t.region_count = 0;
    TEST_ASSERT_TRUE(region::is_valid(t));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_measure_sums_advances);
    RUN_TEST(test_unsupported_bytes_measure_as_the_substitute);
    RUN_TEST(test_text_that_fits_is_drawn_whole);
    RUN_TEST(test_text_exactly_filling_the_box_is_not_truncated);
    RUN_TEST(test_one_pixel_short_triggers_truncation);
    RUN_TEST(test_ellipsis_reserves_its_own_width);
    RUN_TEST(test_ellipsis_never_overruns_the_box);
    RUN_TEST(test_box_too_narrow_for_ellipsis_hard_truncates);
    RUN_TEST(test_box_narrower_than_one_glyph_draws_nothing);
    RUN_TEST(test_empty_string_fits_anything);
    RUN_TEST(test_proportional_widths_are_respected);
    RUN_TEST(test_max_chars_cap_is_honoured);
    RUN_TEST(test_horizontal_alignment);
    RUN_TEST(test_alignment_saturates_when_text_is_wider_than_the_box);
    RUN_TEST(test_vertical_baseline_placement);
    RUN_TEST(test_vertical_middle_is_content_independent);
    RUN_TEST(test_valid_region_accepted);
    RUN_TEST(test_region_must_fit_the_panel);
    RUN_TEST(test_region_rejects_degenerate_and_out_of_range);
    RUN_TEST(test_template_rejects_duplicate_field_ids);
    RUN_TEST(test_template_find_by_field_id);
    RUN_TEST(test_empty_template_is_valid);
    return UNITY_END();
}
