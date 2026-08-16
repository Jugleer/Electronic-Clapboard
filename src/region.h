#pragma once

// Phase 14: the template region model — where each CAN-delivered field lands
// on the panel and how it is drawn.
//
// Header-only and Arduino-free so it links into [env:native].
//
// This struct is a THREE-WAY contract:
//   1. The editor (Phase 15) authors it and ships it over HTTP.
//   2. The firmware persists it in LittleFS alongside the 48 KB background.
//   3. text_render.cpp consumes it every time a field changes.
//
// Because the editor must preview truncation exactly as the panel will
// render it, `font` here is not a free-form name — it is an index into a
// closed table that both sides know (FontId below). Adding a font means
// adding a table entry in text_render.cpp AND a matching metrics export for
// the editor; it is deliberately not something a template can invent.

#include <cstdint>

#include "text_fit.h"

namespace region {

// Frame geometry, mirrored from protocol.md §1. Duplicated here rather than
// included from config.h so this header stays Arduino-free for [env:native].
constexpr uint16_t PANEL_W = 800;
constexpr uint16_t PANEL_H = 480;

// Closed font table. The numeric values are ON THE WIRE (they travel in a
// template pushed by the editor and persist in flash), so they may be
// appended to but never reordered or reused.
//
// Sizes are Adafruit's bundled Free* fonts. The x2 entries use GFX's integer
// setTextSize(2) scaling, which doubles the glyph bitmaps — blocky up close,
// but a film slate is read from across a room and 24pt (~33 px) is thin for
// a hero field. Generating true large fonts from a TTF is a quality upgrade
// tracked in the Phase 14 notes, not a blocker: it lands as new table
// entries, so existing templates keep working.
enum class FontId : uint8_t {
    Sans9        = 0,   // labels
    Sans12       = 1,
    SansBold12   = 2,
    SansBold18   = 3,
    SansBold24   = 4,   // default body
    SansBold24x2 = 5,   // hero fields (~68 px)
    // Numerics. A fixed advance stops a take counter jittering sideways as
    // it counts up, which on a slate reads as the panel being unstable.
    //
    // Caveat found while generating the editor's metrics table: Adafruit's
    // FreeMonoBold18pt7b is not perfectly monospaced — lowercase 'q' is
    // 22 px against 21 for every other glyph, evidently a rounding artefact
    // in their font conversion. Digits and uppercase are all 21, so the
    // anti-jitter property holds for what this font is actually for.
    // FreeMonoBold24pt7b has no such outlier.
    MonoBold18   = 6,
    MonoBold24   = 7,
    _Count       = 8,
};

struct Region {
    uint8_t          field_id;  // 0..can_frames::MAX_FIELDS-1
    int16_t          x, y;      // top-left of the box, panel coordinates
    uint16_t         w, h;
    FontId           font;
    text_fit::HAlign halign;
    text_fit::VAlign valign;
    // Invert draws the box filled with ink and the text in paper. Useful for
    // a header bar. Costs a full rect fill per render, which at 1bpp is
    // nothing.
    bool             invert;
};

// A whole template's worth. Sized to can_frames::MAX_FIELDS; a template may
// define fewer, and any field_id without a region is simply not drawn.
constexpr uint8_t MAX_REGIONS = 8;

struct Template {
    uint8_t  id;                       // 0..15, matches CLAP_COMMIT byte 0
    uint8_t  region_count;
    Region   regions[MAX_REGIONS];
};

// True when the box lies entirely inside the panel and has positive area.
//
// Validated on load rather than trusted, because a template arrives over the
// network and persists across reboots: a bad one would otherwise fail at
// render time, once per field update, forever. Rejecting at the door means a
// corrupt template is a visible upload error instead of a mystery.
inline bool is_valid(const Region& r) {
    if (r.w == 0 || r.h == 0) return false;
    if (r.x < 0 || r.y < 0)   return false;
    if ((int32_t) r.x + r.w > PANEL_W) return false;
    if ((int32_t) r.y + r.h > PANEL_H) return false;
    if (r.field_id >= MAX_REGIONS)     return false;
    if ((uint8_t) r.font >= (uint8_t) FontId::_Count) return false;
    return true;
}

// True when every region is valid AND no two regions claim the same
// field_id. Duplicate ids are rejected rather than last-one-wins because the
// editor is supposed to prevent them (Phase 15 acceptance test 1), so seeing
// one here means the template did not come from the editor — or came from a
// version of it that disagrees with this firmware.
inline bool is_valid(const Template& t) {
    if (t.region_count > MAX_REGIONS) return false;
    uint8_t seen = 0;
    for (uint8_t i = 0; i < t.region_count; ++i) {
        if (!is_valid(t.regions[i])) return false;
        const uint8_t bit = (uint8_t)(1u << t.regions[i].field_id);
        if (seen & bit) return false;
        seen = (uint8_t)(seen | bit);
    }
    return true;
}

// Find the region for a field, or nullptr. Linear over at most 8 entries —
// a map would cost more than it saves.
inline const Region* find(const Template& t, uint8_t field_id) {
    for (uint8_t i = 0; i < t.region_count; ++i) {
        if (t.regions[i].field_id == field_id) return &t.regions[i];
    }
    return nullptr;
}

}  // namespace region
