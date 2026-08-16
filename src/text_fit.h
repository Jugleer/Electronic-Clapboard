#pragma once

// Phase 14: pure text-fitting logic — how much of a string fits in a box,
// where to put it, and when to ellipsise.
//
// Header-only and Arduino-free so it links into [env:native], mirroring
// fire_state.h / can_frames.h. It knows nothing about fonts: callers hand it
// a table of per-character advance widths, which text_render.cpp builds from
// a GFXfont and the native tests fabricate. That split is what makes the
// truncation rules testable without a display attached.
//
// The model is FIXED SIZE, CLIP + ELLIPSIS (no shrink-to-fit). Each region
// carries its font from authoring time, and overflow is truncated. The
// deciding argument was that it makes the editor's preview *truthful*: with
// no runtime reflow, what the author sees at design time is exactly what the
// panel renders, including where the truncation lands.

#include <cstdint>

namespace text_fit {

// Adafruit's bundled Free* fonts cover printable ASCII only. Anything
// outside this range — including the U+2026 ellipsis character — has no
// glyph, which is why the ellipsis below is three ASCII periods and not "…".
constexpr char    FIRST_PRINTABLE   = 0x20;
constexpr char    LAST_PRINTABLE    = 0x7E;
constexpr uint8_t ADVANCE_TABLE_LEN = LAST_PRINTABLE - FIRST_PRINTABLE + 1;  // 95

constexpr char    ELLIPSIS[]      = "...";
constexpr uint8_t ELLIPSIS_CHARS  = 3;

// Substituted for any byte with no glyph. protocol.md §8.3 specifies this
// for bytes >= 0x80; we apply it to control characters too. Rendering a
// visible '?' beats dropping the character silently — a mangled glyph tells
// the operator something is wrong with the data, a missing one does not.
constexpr char SUBSTITUTE = '?';

enum class HAlign : uint8_t { Left = 0, Center = 1, Right = 2 };
enum class VAlign : uint8_t { Top = 0, Middle = 1, Bottom = 2 };

struct FitResult {
    uint8_t  draw_len;     // how many chars of the source to draw
    bool     ellipsis;     // append ELLIPSIS after those chars
    uint16_t pixel_width;  // width of everything that will be drawn
    bool     overflowed;   // the source did not fit, ellipsis or not
};

// Map any byte onto a table index. Out-of-range bytes become SUBSTITUTE.
inline uint8_t advance_index(char c) {
    const unsigned char u = (unsigned char) c;
    if (u < (unsigned char) FIRST_PRINTABLE || u > (unsigned char) LAST_PRINTABLE) {
        return (uint8_t)(SUBSTITUTE - FIRST_PRINTABLE);
    }
    return (uint8_t)(u - (unsigned char) FIRST_PRINTABLE);
}

inline uint16_t advance_of(char c, const uint16_t* adv) {
    return adv[advance_index(c)];
}

// Total advance width of the first `len` characters.
inline uint16_t measure(const char* s, uint8_t len, const uint16_t* adv) {
    uint16_t w = 0;
    for (uint8_t i = 0; i < len; ++i) w = (uint16_t)(w + advance_of(s[i], adv));
    return w;
}

inline uint8_t str_len(const char* s, uint8_t cap) {
    uint8_t n = 0;
    while (n < cap && s[n] != '\0') ++n;
    return n;
}

// Decide what to draw for `s` inside `max_w` pixels.
//
// Three outcomes:
//   1. It fits              → draw everything, no ellipsis.
//   2. It doesn't, but the ellipsis does → draw the longest prefix such that
//      prefix + "..." fits.
//   3. Not even "..." fits  → HARD TRUNCATE with no ellipsis, drawing the
//      longest prefix that fits on its own.
//
// Case 3 is the interesting one. The tempting alternative is to draw nothing,
// on the grounds that a region too narrow for an ellipsis is an authoring
// mistake that should be made obvious. That is wrong for a film slate: a
// blank region reads as "no scene number", which is a *false statement*,
// whereas "Sce" is a true-but-incomplete one. Incomplete beats wrong when a
// camera department is reading it. `overflowed` stays true either way, so a
// caller that wants to surface the authoring error still can.
inline FitResult fit(const char* s, uint8_t max_chars, uint16_t max_w,
                     const uint16_t* adv) {
    FitResult r{};
    const uint8_t len = str_len(s, max_chars);

    const uint16_t full = measure(s, len, adv);
    if (full <= max_w) {
        r.draw_len    = len;
        r.ellipsis    = false;
        r.pixel_width = full;
        r.overflowed  = false;
        return r;
    }

    r.overflowed = true;

    const uint16_t ell_w = measure(ELLIPSIS, ELLIPSIS_CHARS, adv);
    if (ell_w <= max_w) {
        // Longest prefix such that prefix + ellipsis still fits.
        uint16_t used = ell_w;
        uint8_t  n    = 0;
        while (n < len) {
            const uint16_t next = (uint16_t)(used + advance_of(s[n], adv));
            if (next > max_w) break;
            used = next;
            ++n;
        }
        r.draw_len    = n;
        r.ellipsis    = true;
        r.pixel_width = used;
        return r;
    }

    // Case 3: hard truncate, no ellipsis.
    uint16_t used = 0;
    uint8_t  n    = 0;
    while (n < len) {
        const uint16_t next = (uint16_t)(used + advance_of(s[n], adv));
        if (next > max_w) break;
        used = next;
        ++n;
    }
    r.draw_len    = n;
    r.ellipsis    = false;
    r.pixel_width = used;
    return r;
}

// X offset of the drawn text within a region of `region_w`.
//
// Saturates at 0 rather than going negative: a drawn width wider than the
// region should only happen if a caller ignores fit(), and letting the text
// start left of the region would corrupt whatever is drawn beside it.
inline int16_t h_offset(uint16_t drawn_w, uint16_t region_w, HAlign a) {
    if (drawn_w >= region_w) return 0;
    switch (a) {
        case HAlign::Center: return (int16_t)((region_w - drawn_w) / 2);
        case HAlign::Right:  return (int16_t)(region_w - drawn_w);
        case HAlign::Left:
        default:             return 0;
    }
}

// ── Multi-line wrapping ───────────────────────────────────────────────────
//
// A field wraps at its box width and keeps going down until the NEXT line
// would not fit vertically. Only when both dimensions are exhausted does the
// ellipsis appear, on the final line.
//
// Word-boundary breaks are preferred; a single word wider than the box falls
// back to breaking mid-word, because otherwise it can never be placed and
// the field renders empty — the failure Phase 14 already rejected on the
// grounds that a blank region reads as "no data", which is a false statement
// rather than an incomplete one.

// Ceiling on lines per field. 32 characters cannot legitimately wrap past
// this: it would need a box under ~3 characters wide, which is degenerate
// authoring. Overflow past the cap is treated as "ran out of vertical
// space", which is the correct outcome anyway.
constexpr uint8_t MAX_LINES = 12;

struct Line {
    uint8_t  start;     // index into the source string
    uint8_t  len;       // characters on this line, trailing spaces trimmed
    uint16_t width;     // pixel width including the ellipsis if present
    bool     ellipsis;  // this line ends with ELLIPSIS
};

struct WrapResult {
    uint8_t  line_count;
    Line     lines[MAX_LINES];
    bool     overflowed;    // text remained after the last placed line
    uint16_t block_height;  // ascent + descent + (line_count-1) * line_height
};

// Lay `s` out inside a `max_w` × `max_h` box.
//
// `line_height` is the font's line advance. `ascent`/`descent` are needed
// for the block height, which vertical alignment depends on.
//
// An explicit '\n' forces a break. Handling it here rather than letting it
// fall through to advance_of() matters: '\n' is outside printable ASCII, so
// the substitution rule would otherwise render it as a literal '?'.
inline WrapResult wrap(const char* s, uint8_t max_chars,
                       uint16_t max_w, uint16_t max_h,
                       uint8_t line_height, uint8_t ascent, uint8_t descent,
                       const uint16_t* adv) {
    WrapResult r{};
    const uint8_t len = str_len(s, max_chars);

    uint8_t max_lines = (line_height > 0)
                            ? (uint8_t)(max_h / line_height)
                            : (uint8_t) 1;
    // A box shorter than one line still gets one line, clipped by the
    // caller's clip rect. Same reasoning as the too-narrow case.
    if (max_lines == 0)          max_lines = 1;
    if (max_lines > MAX_LINES)   max_lines = MAX_LINES;

    uint8_t i = 0;
    while (i < len && r.line_count < max_lines) {
        // Whitespace at a wrap point is an artefact of the break, not
        // content — leading spaces on line 2 would look like a stray indent.
        // Line 0 keeps its leading spaces; those came from the operator.
        if (r.line_count > 0) {
            while (i < len && s[i] == ' ') ++i;
            if (i >= len) break;
        }

        const uint8_t line_start = i;
        uint16_t w        = 0;
        uint8_t  n        = 0;
        uint8_t  break_at = 0;   // chars to take for a word-boundary break
        uint16_t break_w  = 0;
        bool     hard_nl  = false;

        while (line_start + n < len) {
            const char c = s[line_start + n];
            if (c == '\n') { hard_nl = true; break; }
            const uint16_t a = advance_of(c, adv);
            if (w + a > max_w) break;
            w = (uint16_t)(w + a);
            ++n;
            if (c == ' ') { break_at = n; break_w = w; }
        }

        const bool reached_end = (line_start + n >= len) || hard_nl;

        uint8_t  take   = n;
        uint16_t take_w = w;
        if (!reached_end) {
            if (break_at > 0) {
                // Word wrap.
                take   = break_at;
                take_w = break_w;
            } else if (n == 0) {
                // Not even one glyph fits. Take one anyway: zero would spin
                // this loop forever, and the clip rect stops it escaping.
                take   = 1;
                take_w = advance_of(s[line_start], adv);
            }
            // else: an over-long word — break mid-word at `n`.
        }

        // Trim trailing spaces so they don't skew centring or right-align.
        uint8_t  trimmed   = take;
        uint16_t trimmed_w = take_w;
        while (trimmed > 0 && s[line_start + trimmed - 1] == ' ') {
            --trimmed;
            trimmed_w = (uint16_t)(trimmed_w - advance_of(s[line_start + trimmed], adv));
        }

        r.lines[r.line_count].start    = line_start;
        r.lines[r.line_count].len      = trimmed;
        r.lines[r.line_count].width    = trimmed_w;
        r.lines[r.line_count].ellipsis = false;
        ++r.line_count;

        i = (uint8_t)(line_start + take);
        if (hard_nl) ++i;   // consume the newline itself
    }

    // Is anything left? Trailing whitespace is not content, so a value
    // ending in spaces must not report an overflow.
    uint8_t rest = i;
    while (rest < len && (s[rest] == ' ' || s[rest] == '\n')) ++rest;
    r.overflowed = (rest < len);

    if (r.overflowed && r.line_count > 0) {
        Line& last = r.lines[r.line_count - 1];
        const uint16_t ell_w = measure(ELLIPSIS, ELLIPSIS_CHARS, adv);
        if (ell_w <= max_w) {
            // Shrink the final line until content + ellipsis fits.
            uint16_t w2 = last.width;
            uint8_t  n2 = last.len;
            while (n2 > 0 && (uint16_t)(w2 + ell_w) > max_w) {
                --n2;
                w2 = (uint16_t)(w2 - advance_of(s[last.start + n2], adv));
            }
            last.len      = n2;
            last.width    = (uint16_t)(w2 + ell_w);
            last.ellipsis = true;
        }
        // else: too narrow for even the ellipsis — leave the hard truncation
        // in place, per the same rule single-line fit() applies.
    }

    r.block_height = (r.line_count == 0)
                         ? 0
                         : (uint16_t)(ascent + descent +
                                      (uint16_t)(r.line_count - 1) * line_height);
    return r;
}

// Y offset of the FIRST line's baseline within a region of `region_h`.
//
// GFX custom fonts position glyphs relative to a baseline, not a top edge,
// so every vertical alignment resolves to "where does the baseline go".
// `ascent` is the tallest glyph extent above the baseline and `descent` the
// deepest below — both taken from the font, not from the string, so a region
// containing "xyz" aligns identically to one containing "XYZ". Using the
// string's own extents would make fields visibly jump as their content
// changed, which on a slate looks like a rendering fault.
inline int16_t v_block_baseline(uint16_t region_h, VAlign a,
                                uint8_t ascent, uint8_t descent,
                                uint8_t line_count, uint8_t line_height) {
    if (line_count == 0) line_count = 1;
    const int32_t block_h = (int32_t) ascent + descent +
                            (int32_t)(line_count - 1) * line_height;
    switch (a) {
        case VAlign::Middle:
            return (int16_t)(((int32_t) region_h - block_h) / 2 + ascent);
        case VAlign::Bottom:
            return (int16_t)((int32_t) region_h - block_h + ascent);
        case VAlign::Top:
        default:
            return (int16_t) ascent;
    }
}

// Single-line convenience wrapper, kept because the one-line case is still
// the common one and reads better at call sites than passing line_count=1.
inline int16_t v_baseline(uint16_t region_h, VAlign a,
                          uint8_t ascent, uint8_t descent) {
    return v_block_baseline(region_h, a, ascent, descent, 1, 0);
}

}  // namespace text_fit
