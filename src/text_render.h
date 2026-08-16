#pragma once

// Phase 14: draw a CAN-delivered field string into its template region.
//
// This is the Arduino-side bridge between two pure pieces:
//   region.h    — where the box is and how it should look
//   text_fit.h  — how much of the string fits and where it goes
// Everything font-shaped lives here, because GFXfont is an Arduino type.
//
// The bridge's real job is building an ADVANCE TABLE: text_fit needs the
// pixel width of each printable ASCII character, and that comes from walking
// a GFXfont's glyph array. Tables are built once per font at begin() and
// cached, because rebuilding 95 entries per field per render would be the
// most expensive thing in the composite path by an order of magnitude.

#include <cstdint>

#include "region.h"
#include "text_fit.h"

namespace text_render {

// Build and cache the advance tables for every FontId. Call once from
// setup(), after framebuffer::begin(). Idempotent.
void begin();

// Metrics for one font, exposed so the editor can eventually be handed the
// same numbers and preview truncation pixel-exactly (see the Phase 14 notes
// on editor/firmware font agreement).
struct FontMetrics {
    uint8_t  ascent;    // tallest extent above the baseline, px
    uint8_t  descent;   // deepest extent below, px
    uint8_t  line_h;    // yAdvance × size
    const uint16_t* advances;  // ADVANCE_TABLE_LEN entries, px
};

const FontMetrics& metrics(region::FontId id);

// Result of drawing one field, surfaced so a caller can log or report that
// authoring produced a box too small for its content.
struct DrawResult {
    bool     drawn;        // false if the region was invalid or fonts aren't up
    bool     overflowed;   // text did not fit and was truncated
    uint16_t pixel_width;  // width of the widest line drawn
    uint8_t  line_count;   // lines the value wrapped onto
};

// Draw `text` into `r` on the composite framebuffer. Assumes the background
// has already been blitted; this only paints the region.
//
// Wraps at the box width and continues onto further lines until the next
// would not fit vertically; the ellipsis appears only when both dimensions
// are exhausted. Drawing is clipped to the region, so a font taller than its
// box degrades to cut glyphs rather than painting over its neighbours.
//
// Clears the box to paper (or fills it with ink when r.invert) before
// drawing, so a shorter value cannot leave fragments of a longer previous
// one behind. That matters more than it sounds: field updates are patches,
// so "Take 12" → "Take 9" is a routine transition and a stale trailing "2"
// would be indistinguishable from correct output.
DrawResult draw_field(const region::Region& r, const char* text);

// Draw every field of a template. `values` is indexed by field_id; a null or
// empty entry clears that region rather than leaving the background showing,
// which keeps "field explicitly blank" visually distinct from "field never
// set" only if the template's background carries a label — that is an
// authoring choice, not a firmware one.
void draw_all(const region::Template& t,
              const char* const values[region::MAX_REGIONS]);

}  // namespace text_render
