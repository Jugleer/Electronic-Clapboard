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

// Y offset of the text BASELINE within a region of `region_h`.
//
// GFX custom fonts position glyphs relative to a baseline, not a top edge,
// so every vertical alignment resolves to "where does the baseline go".
// `ascent` is the tallest glyph extent above the baseline and `descent` the
// deepest below — both taken from the font, not from the string, so a region
// containing "xyz" aligns identically to one containing "XYZ". Using the
// string's own extents would make fields visibly jump as their content
// changed, which on a slate looks like a rendering fault.
inline int16_t v_baseline(uint16_t region_h, VAlign a,
                          uint8_t ascent, uint8_t descent) {
    switch (a) {
        case VAlign::Middle: {
            const int32_t text_h = (int32_t) ascent + descent;
            return (int16_t)(((int32_t) region_h - text_h) / 2 + ascent);
        }
        case VAlign::Bottom: return (int16_t)((int32_t) region_h - descent);
        case VAlign::Top:
        default:             return (int16_t) ascent;
    }
}

}  // namespace text_fit
