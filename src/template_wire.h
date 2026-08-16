#pragma once

// Phase 15: the template upload wire format — a 48,000-byte background
// raster followed by a fixed 100-byte region trailer.
//
// Header-only and Arduino-free so it links into [env:native], and so the
// same parse/serialise rules are unit-tested rather than trusted.
//
// WHY FIXED-LENGTH BINARY RATHER THAN JSON:
// The project already ships a binary frame contract (protocol.md §1) with a
// Python mirror and a TS mirror cross-checked against a committed oracle
// fixture. A template is a frame plus eight small structs; making the second
// half JSON would mean putting a JSON parser on the critical path of a 48 KB
// upload, and would make the body length variable — which matters because
// /frame's single most useful validation is "Content-Length must be exactly
// 48000". A fixed 48,100 keeps that check, and keeps the ESP32 side to
// pointer arithmetic.
//
// Regions are always transmitted as all 8 slots; `region_count` says how
// many are meaningful. Padding to a constant size buys the fixed-length
// check above for 96 bytes of a 48 KB upload.

#include <cstdint>

#include "region.h"

namespace template_wire {

constexpr uint32_t RASTER_BYTES   = 48000;
constexpr uint8_t  REGION_BYTES   = 12;
constexpr uint8_t  TRAILER_HEADER = 4;
constexpr uint8_t  TRAILER_BYTES  = TRAILER_HEADER + REGION_BYTES * region::MAX_REGIONS;  // 100
constexpr uint32_t BODY_BYTES     = RASTER_BYTES + TRAILER_BYTES;                          // 48100

static_assert(TRAILER_BYTES == 100, "trailer size is part of the wire contract");
static_assert(BODY_BYTES == 48100,  "body size is part of the wire contract");

// Bytes 'T','L' — little-endian 0x4C54. Present so a truncated or
// mis-routed /frame body cannot be mistaken for a template: without it, the
// first 48,000 bytes of any frame POST would parse as a valid raster and the
// trailing 100 bytes as garbage regions.
constexpr uint16_t MAGIC   = 0x4C54;
constexpr uint8_t  VERSION = 1;

// How many templates the device stores. The wire allows template_id 0-15
// (protocol.md §8.4), but flash does not: the slate_data partition is
// 3.456 MB, the screensaver may occupy 50 × 48,000 = 2.4 MB of it, and 8
// templates at 48,100 add 385 KB for a 2.78 MB total with ~20% headroom.
// Sixteen would leave almost none. An id at or above this returns
// Outcome::NoTemplate rather than being silently clamped.
constexpr uint8_t MAX_TEMPLATES = 8;

// ── Little-endian helpers (duplicated from can_frames.h deliberately: these
// two headers are separate wire contracts and must not acquire a dependency
// on each other's evolution) ──────────────────────────────────────────────

inline void     put_u16(uint8_t* p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
inline uint16_t get_u16(const uint8_t* p)       { return (uint16_t)(p[0] | ((uint16_t)p[1] << 8)); }
inline void     put_i16(uint8_t* p, int16_t v)  { put_u16(p, (uint16_t)v); }
inline int16_t  get_i16(const uint8_t* p)       { return (int16_t)get_u16(p); }

// ── Region record (12 bytes) ──────────────────────────────────────────────
//   0     field_id
//   1-2   x       int16 LE
//   3-4   y       int16 LE
//   5-6   w       uint16 LE
//   7-8   h       uint16 LE
//   9     font_id
//   10    flags: bits 0-1 halign, bits 2-3 valign, bit 4 invert
//   11    reserved (must be 0)

constexpr uint8_t FLAG_HALIGN_MASK  = 0x03;
constexpr uint8_t FLAG_VALIGN_SHIFT = 2;
constexpr uint8_t FLAG_VALIGN_MASK  = 0x0C;
constexpr uint8_t FLAG_INVERT       = 0x10;

inline void encode_region(const region::Region& r, uint8_t* d) {
    d[0] = r.field_id;
    put_i16(d + 1, r.x);
    put_i16(d + 3, r.y);
    put_u16(d + 5, r.w);
    put_u16(d + 7, r.h);
    d[9] = (uint8_t) r.font;
    d[10] = (uint8_t)(((uint8_t) r.halign & FLAG_HALIGN_MASK)
                    | (((uint8_t) r.valign << FLAG_VALIGN_SHIFT) & FLAG_VALIGN_MASK)
                    | (r.invert ? FLAG_INVERT : 0));
    d[11] = 0;
}

inline void decode_region(const uint8_t* d, region::Region& r) {
    r.field_id = d[0];
    r.x        = get_i16(d + 1);
    r.y        = get_i16(d + 3);
    r.w        = get_u16(d + 5);
    r.h        = get_u16(d + 7);
    r.font     = (region::FontId) d[9];
    r.halign   = (text_fit::HAlign)(d[10] & FLAG_HALIGN_MASK);
    r.valign   = (text_fit::VAlign)((d[10] & FLAG_VALIGN_MASK) >> FLAG_VALIGN_SHIFT);
    r.invert   = (d[10] & FLAG_INVERT) != 0;
}

// ── Trailer ───────────────────────────────────────────────────────────────

enum class ParseResult : uint8_t {
    Ok            = 0,
    BadMagic      = 1,
    BadVersion    = 2,
    BadCount      = 3,
    InvalidRegion = 4,  // a region failed region::is_valid, or ids collide
};

// Parse the 100-byte trailer that follows the raster. `trailer` must point
// at TRAILER_BYTES readable bytes.
//
// Validates fully before writing anything into `out`, so a rejected upload
// cannot leave a half-populated template behind. That matters because the
// caller's natural next move on failure is to keep using whatever was
// already loaded.
inline ParseResult parse_trailer(const uint8_t* trailer, uint8_t id,
                                 region::Template& out) {
    if (get_u16(trailer) != MAGIC)      return ParseResult::BadMagic;
    if (trailer[2] != VERSION)          return ParseResult::BadVersion;

    const uint8_t count = trailer[3];
    if (count > region::MAX_REGIONS)    return ParseResult::BadCount;

    region::Template t{};
    t.id           = id;
    t.region_count = count;
    for (uint8_t i = 0; i < count; ++i) {
        decode_region(trailer + TRAILER_HEADER + (uint32_t) i * REGION_BYTES,
                      t.regions[i]);
    }
    // region::is_valid(Template) checks bounds, font range, and duplicate
    // field ids in one pass.
    if (!region::is_valid(t)) return ParseResult::InvalidRegion;

    out = t;
    return ParseResult::Ok;
}

// Write a trailer for `t`. Unused region slots are zero-filled so the body
// is byte-stable for a given template — which lets a caller diff two
// uploads, and keeps the format's fixed length honest.
inline void encode_trailer(const region::Template& t, uint8_t* trailer) {
    for (uint32_t i = 0; i < TRAILER_BYTES; ++i) trailer[i] = 0;
    put_u16(trailer, MAGIC);
    trailer[2] = VERSION;
    trailer[3] = t.region_count;
    for (uint8_t i = 0; i < t.region_count && i < region::MAX_REGIONS; ++i) {
        encode_region(t.regions[i],
                      trailer + TRAILER_HEADER + (uint32_t) i * REGION_BYTES);
    }
}

inline const char* parse_result_name(ParseResult r) {
    switch (r) {
        case ParseResult::Ok:            return "ok";
        case ParseResult::BadMagic:      return "bad_magic";
        case ParseResult::BadVersion:    return "bad_version";
        case ParseResult::BadCount:      return "bad_count";
        case ParseResult::InvalidRegion: return "invalid_region";
    }
    return "?";
}

}  // namespace template_wire
