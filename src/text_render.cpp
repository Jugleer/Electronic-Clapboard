#include "text_render.h"

#include <Arduino.h>
#include <Adafruit_GFX.h>

#include <Fonts/FreeMonoBold18pt7b.h>
#include <Fonts/FreeMonoBold24pt7b.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSans12pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>

#include "clap_log.h"
#include "framebuffer.h"

namespace text_render {

namespace {

constexpr uint8_t FONT_COUNT = (uint8_t) region::FontId::_Count;

struct FontDef {
    const GFXfont* font;
    uint8_t        size;   // GFX integer scale factor
};

// Indexed by FontId. Order must match the enum exactly — the enum's numeric
// values are on the wire (region.h), so this table is effectively part of
// the template format.
const FontDef FONTS[FONT_COUNT] = {
    { &FreeSans9pt7b,       1 },  // Sans9
    { &FreeSans12pt7b,      1 },  // Sans12
    { &FreeSansBold12pt7b,  1 },  // SansBold12
    { &FreeSansBold18pt7b,  1 },  // SansBold18
    { &FreeSansBold24pt7b,  1 },  // SansBold24
    { &FreeSansBold24pt7b,  2 },  // SansBold24x2
    { &FreeMonoBold18pt7b,  1 },  // MonoBold18
    { &FreeMonoBold24pt7b,  1 },  // MonoBold24
};

uint16_t     g_advances[FONT_COUNT][text_fit::ADVANCE_TABLE_LEN];
FontMetrics  g_metrics[FONT_COUNT];
bool         g_ready = false;

// Pull one glyph out of a GFXfont, or nullptr when the font has no glyph for
// that codepoint.
const GFXglyph* glyph_for(const GFXfont* f, char c) {
    const unsigned char u = (unsigned char) c;
    if (u < f->first || u > f->last) return nullptr;
    return &f->glyph[u - f->first];
}

void build_font(uint8_t idx) {
    const FontDef& def = FONTS[idx];
    const GFXfont* f   = def.font;
    const uint8_t  sz  = def.size;

    // Substitute glyph width, used for any character the font lacks. text_fit
    // already maps unsupported bytes onto SUBSTITUTE, so this is only a
    // fallback for a font that lacks even '?'.
    const GFXglyph* sub = glyph_for(f, text_fit::SUBSTITUTE);
    const uint16_t sub_adv = sub ? (uint16_t)(sub->xAdvance * sz) : (uint16_t)(6 * sz);

    int16_t max_ascent  = 0;
    int16_t max_descent = 0;

    for (uint8_t i = 0; i < text_fit::ADVANCE_TABLE_LEN; ++i) {
        const char c = (char)(text_fit::FIRST_PRINTABLE + i);
        const GFXglyph* g = glyph_for(f, c);
        g_advances[idx][i] = g ? (uint16_t)(g->xAdvance * sz) : sub_adv;

        if (g) {
            // yOffset is the distance from the baseline to the glyph's TOP,
            // negative for anything above the baseline. So ascent is -yOffset
            // and descent is yOffset + height.
            const int16_t asc = (int16_t)(-g->yOffset);
            const int16_t des = (int16_t)(g->yOffset + g->height);
            if (asc > max_ascent)  max_ascent  = asc;
            if (des > max_descent) max_descent = des;
        }
    }

    // Ascent/descent are taken across the WHOLE font, not per string, so a
    // region holding "xyz" sits identically to one holding "XYZ". Deriving
    // them per string would make fields visibly jump as their content
    // changed, which on a slate looks like a rendering fault.
    g_metrics[idx].ascent   = (uint8_t)(max_ascent  * sz);
    g_metrics[idx].descent  = (uint8_t)(max_descent * sz);
    g_metrics[idx].line_h   = (uint8_t)(f->yAdvance * sz);
    g_metrics[idx].advances = g_advances[idx];
}

}  // namespace

void begin() {
    if (g_ready) return;
    for (uint8_t i = 0; i < FONT_COUNT; ++i) build_font(i);
    g_ready = true;

    clap_log("[text] %u fonts ready; SansBold24 asc=%u desc=%u line=%u, "
             "SansBold24x2 asc=%u",
             (unsigned) FONT_COUNT,
             (unsigned) g_metrics[(uint8_t) region::FontId::SansBold24].ascent,
             (unsigned) g_metrics[(uint8_t) region::FontId::SansBold24].descent,
             (unsigned) g_metrics[(uint8_t) region::FontId::SansBold24].line_h,
             (unsigned) g_metrics[(uint8_t) region::FontId::SansBold24x2].ascent);
}

const FontMetrics& metrics(region::FontId id) {
    return g_metrics[(uint8_t) id];
}

DrawResult draw_field(const region::Region& r, const char* text) {
    DrawResult out{};
    if (!g_ready || !framebuffer::ready()) return out;
    if (!region::is_valid(r))              return out;

    framebuffer::Canvas1& c = framebuffer::canvas();

    // Ink/paper for this region. Inverted regions swap both the fill and the
    // glyph colour so the box reads as a solid bar with knocked-out text.
    const uint16_t paper = r.invert ? 1 : 0;
    const uint16_t ink   = r.invert ? 0 : 1;

    // Wipe first — see the header comment: patch semantics make
    // longer-then-shorter a routine transition, and a stale trailing glyph
    // is indistinguishable from correct output.
    c.fillRect(r.x, r.y, (int16_t) r.w, (int16_t) r.h, paper);

    if (!text || text[0] == '\0') {
        out.drawn = true;
        return out;
    }

    const uint8_t      fi = (uint8_t) r.font;
    const FontMetrics& m  = g_metrics[fi];
    const FontDef&     fd = FONTS[fi];

    const text_fit::WrapResult wr =
        text_fit::wrap(text, /*max_chars=*/UINT8_MAX, r.w, r.h,
                       m.line_h, m.ascent, m.descent, m.advances);

    const int16_t first_baseline = text_fit::v_block_baseline(
        r.h, r.valign, m.ascent, m.descent, wr.line_count, m.line_h);

    c.setFont(fd.font);
    c.setTextSize(fd.size);
    c.setTextColor(ink);          // one-arg form: no background fill, we wiped already
    c.setTextWrap(false);         // GFX's own wrap is at the panel edge, not the box

    // Confine drawing to the region for the duration. Without this a font
    // taller than its box paints descenders over the field below, and with
    // wrapping that stops being a corner case — a box one line short spills
    // an entire line. Restored before returning so the next caller (and the
    // background blit) sees an unclipped canvas.
    c.set_clip(r.x, r.y, (int16_t) r.w, (int16_t) r.h);

    uint16_t widest = 0;
    for (uint8_t li = 0; li < wr.line_count; ++li) {
        const text_fit::Line& ln = wr.lines[li];
        if (ln.width > widest) widest = ln.width;

        const int16_t dx = text_fit::h_offset(ln.width, r.w, r.halign);
        const int16_t by = (int16_t)(first_baseline + (int16_t)(li * m.line_h));
        c.setCursor((int16_t)(r.x + dx), (int16_t)(r.y + by));

        // Character by character, substituting anything the font can't
        // render. write() rather than print() keeps the substitution in one
        // place and avoids a temporary String.
        for (uint8_t i = 0; i < ln.len; ++i) {
            const char raw = text[ln.start + i];
            const char ch  = (glyph_for(fd.font, raw) != nullptr)
                                 ? raw : text_fit::SUBSTITUTE;
            c.write((uint8_t) ch);
        }
        if (ln.ellipsis) {
            for (uint8_t i = 0; i < text_fit::ELLIPSIS_CHARS; ++i) {
                c.write((uint8_t) text_fit::ELLIPSIS[i]);
            }
        }
    }

    c.clear_clip();

    out.drawn       = true;
    out.overflowed  = wr.overflowed;
    out.pixel_width = widest;
    out.line_count  = wr.line_count;
    return out;
}

void draw_all(const region::Template& t,
              const char* const values[region::MAX_REGIONS]) {
    if (!region::is_valid(t)) {
        clap_log("[text] template %u rejected as invalid — nothing drawn",
                 (unsigned) t.id);
        return;
    }
    for (uint8_t i = 0; i < t.region_count; ++i) {
        const region::Region& r = t.regions[i];
        const char* v = values ? values[r.field_id] : nullptr;
        const DrawResult res = draw_field(r, v);
        if (res.overflowed) {
            // Worth a log line: it means an authored box is too small for
            // real data, which is invisible on the panel apart from the
            // ellipsis and easy to miss during a shoot.
            clap_log("[text] field %u overflowed its %ux%u region "
                     "(%u lines, widest %u px)",
                     (unsigned) r.field_id, (unsigned) r.w, (unsigned) r.h,
                     (unsigned) res.line_count, (unsigned) res.pixel_width);
        }
    }
}

}  // namespace text_render
