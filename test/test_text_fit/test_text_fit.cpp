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

// ── multi-line wrapping ───────────────────────────────────────────────────
//
// Fixture font: 10 px advance, 20 px line height, ascent 15, descent 5. So a
// 60 px box is exactly 3 lines and 6 characters wide, which keeps every
// assertion arithmetic-obvious.
constexpr uint8_t  LH   = 20;
constexpr uint8_t  ASC  = 15;
constexpr uint8_t  DESC = 5;

static std::string line_text(const char* src, const Line& l) {
    std::string s(src + l.start, src + l.start + l.len);
    if (l.ellipsis) s += ELLIPSIS;
    return s;
}

static void test_wrap_breaks_at_word_boundaries() {
    const char* s = "SCENE FOUR TAKE";
    const WrapResult r = wrap(s, UINT8_MAX, 60, 60, LH, ASC, DESC, g_mono);

    TEST_ASSERT_EQUAL_UINT8(3, r.line_count);
    TEST_ASSERT_FALSE(r.overflowed);
    TEST_ASSERT_EQUAL_STRING("SCENE", line_text(s, r.lines[0]).c_str());
    TEST_ASSERT_EQUAL_STRING("FOUR",  line_text(s, r.lines[1]).c_str());
    TEST_ASSERT_EQUAL_STRING("TAKE",  line_text(s, r.lines[2]).c_str());
}

static void test_wrap_swallows_the_space_at_a_break() {
    // A leading space on line 2 would render as a stray indent.
    const char* s = "AB CD";
    const WrapResult r = wrap(s, UINT8_MAX, 20, 60, LH, ASC, DESC, g_mono);
    TEST_ASSERT_EQUAL_UINT8(2, r.line_count);
    TEST_ASSERT_EQUAL_STRING("AB", line_text(s, r.lines[0]).c_str());
    TEST_ASSERT_EQUAL_STRING("CD", line_text(s, r.lines[1]).c_str());
}

static void test_ellipsis_only_once_both_dimensions_are_exhausted() {
    // The headline requirement: text keeps flowing onto new lines, and the
    // ellipsis appears only when there is no more vertical room either.
    const char* s = "AAAA BBBB CCCC DDDD";

    // Tall enough for all four words — no ellipsis despite not fitting on
    // one line.
    const WrapResult tall = wrap(s, UINT8_MAX, 50, 100, LH, ASC, DESC, g_mono);
    TEST_ASSERT_FALSE(tall.overflowed);
    TEST_ASSERT_EQUAL_UINT8(4, tall.line_count);

    // Two lines' worth of height — now it must ellipsise on the last line.
    const WrapResult shortbox = wrap(s, UINT8_MAX, 50, 40, LH, ASC, DESC, g_mono);
    TEST_ASSERT_TRUE(shortbox.overflowed);
    TEST_ASSERT_EQUAL_UINT8(2, shortbox.line_count);
    TEST_ASSERT_FALSE(shortbox.lines[0].ellipsis);
    TEST_ASSERT_TRUE(shortbox.lines[1].ellipsis);
    TEST_ASSERT_EQUAL_STRING("AAAA", line_text(s, shortbox.lines[0]).c_str());
    TEST_ASSERT_EQUAL_STRING("BB...", line_text(s, shortbox.lines[1]).c_str());
}

static void test_wrap_breaks_an_overlong_word_mid_word() {
    // A word wider than the box can never be placed on a boundary. Dropping
    // it would leave the field empty, which is the failure the whole
    // clip-not-blank rule exists to avoid.
    const char* s = "SUPERCALIFRAGILISTIC";
    const WrapResult r = wrap(s, UINT8_MAX, 50, 40, LH, ASC, DESC, g_mono);
    TEST_ASSERT_EQUAL_UINT8(2, r.line_count);
    TEST_ASSERT_EQUAL_STRING("SUPER", line_text(s, r.lines[0]).c_str());
    TEST_ASSERT_TRUE(r.overflowed);
}

static void test_explicit_newline_forces_a_break() {
    // '\n' is outside printable ASCII, so without special handling the
    // substitution rule would render it as a literal '?'.
    const char* s = "AB\nCD";
    const WrapResult r = wrap(s, UINT8_MAX, 100, 60, LH, ASC, DESC, g_mono);
    TEST_ASSERT_EQUAL_UINT8(2, r.line_count);
    TEST_ASSERT_EQUAL_STRING("AB", line_text(s, r.lines[0]).c_str());
    TEST_ASSERT_EQUAL_STRING("CD", line_text(s, r.lines[1]).c_str());
    TEST_ASSERT_FALSE(r.overflowed);
}

static void test_trailing_whitespace_is_not_an_overflow() {
    const char* s = "AB   ";
    const WrapResult r = wrap(s, UINT8_MAX, 40, 20, LH, ASC, DESC, g_mono);
    TEST_ASSERT_FALSE(r.overflowed);
    TEST_ASSERT_EQUAL_UINT8(1, r.line_count);
    // Trailing spaces must not skew the width, or centring drifts right.
    TEST_ASSERT_EQUAL_UINT16(20, r.lines[0].width);
}

static void test_box_shorter_than_one_line_still_draws_one() {
    // Clipped by the caller's clip rect. Blank would read as "no data".
    const WrapResult r = wrap("HELLO", UINT8_MAX, 100, 5, LH, ASC, DESC, g_mono);
    TEST_ASSERT_EQUAL_UINT8(1, r.line_count);
}

static void test_wrap_never_exceeds_the_box_width() {
    // Sweep: whatever any line reports drawing must fit horizontally.
    const char* s = "The quick brown fox jumps over";
    for (uint16_t w = 10; w <= 200; w += 5) {
        const WrapResult r = wrap(s, UINT8_MAX, w, 200, LH, ASC, DESC, g_mono);
        for (uint8_t i = 0; i < r.line_count; ++i) {
            TEST_ASSERT_TRUE_MESSAGE(r.lines[i].width <= w,
                                     "wrapped line wider than its box");
        }
    }
}

static void test_wrap_line_count_never_exceeds_the_cap() {
    // A pathologically narrow box must terminate, not spin or overrun the
    // fixed lines[] array.
    const WrapResult r = wrap("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
                              UINT8_MAX, 5, 10000, LH, ASC, DESC, g_mono);
    TEST_ASSERT_TRUE(r.line_count <= MAX_LINES);
    TEST_ASSERT_TRUE(r.overflowed);
}

static void test_block_height_matches_the_line_count() {
    const WrapResult r = wrap("AAAA BBBB CCCC", UINT8_MAX, 50, 100, LH, ASC, DESC, g_mono);
    TEST_ASSERT_EQUAL_UINT8(3, r.line_count);
    // ascent + descent + (3-1) * lineHeight = 15 + 5 + 40
    TEST_ASSERT_EQUAL_UINT16(60, r.block_height);
}

static void test_block_baseline_positions_all_three_alignments() {
    // Two lines: block is 15 + 5 + 20 = 40 tall in a 100 px box.
    TEST_ASSERT_EQUAL_INT16(15, v_block_baseline(100, VAlign::Top, ASC, DESC, 2, LH));
    // Middle: (100-40)/2 + 15 = 30 + 15
    TEST_ASSERT_EQUAL_INT16(45, v_block_baseline(100, VAlign::Middle, ASC, DESC, 2, LH));
    // Bottom: 100 - 40 + 15
    TEST_ASSERT_EQUAL_INT16(75, v_block_baseline(100, VAlign::Bottom, ASC, DESC, 2, LH));
}

static void test_single_line_block_baseline_matches_the_old_helper() {
    // v_baseline() is now a wrapper; a regression here would silently shift
    // every existing single-line field.
    for (uint8_t a = 0; a < 3; ++a) {
        const VAlign va = (VAlign) a;
        TEST_ASSERT_EQUAL_INT16(v_baseline(100, va, 30, 8),
                                v_block_baseline(100, va, 30, 8, 1, 0));
    }
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
    RUN_TEST(test_wrap_breaks_at_word_boundaries);
    RUN_TEST(test_wrap_swallows_the_space_at_a_break);
    RUN_TEST(test_ellipsis_only_once_both_dimensions_are_exhausted);
    RUN_TEST(test_wrap_breaks_an_overlong_word_mid_word);
    RUN_TEST(test_explicit_newline_forces_a_break);
    RUN_TEST(test_trailing_whitespace_is_not_an_overflow);
    RUN_TEST(test_box_shorter_than_one_line_still_draws_one);
    RUN_TEST(test_wrap_never_exceeds_the_box_width);
    RUN_TEST(test_wrap_line_count_never_exceeds_the_cap);
    RUN_TEST(test_block_height_matches_the_line_count);
    RUN_TEST(test_block_baseline_positions_all_three_alignments);
    RUN_TEST(test_single_line_block_baseline_matches_the_old_helper);
    return UNITY_END();
}
