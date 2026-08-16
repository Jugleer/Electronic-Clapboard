#pragma once

// Phase 14: the composite framebuffer — an 800×480 1bpp buffer in PSRAM that
// doubles as an Adafruit_GFX drawing surface.
//
// WHY A GFX SUBCLASS AND NOT GFXcanvas1:
// GFXcanvas1's internal buffer layout is already byte-identical to our wire
// format — MSB-first within a byte, 1 = set, ((w+7)/8) bytes per row, which
// at 800 px is exactly 100 with no padding (protocol.md §1). So the format
// is free either way. What is NOT free is where the memory lives: GFXcanvas1
// mallocs into internal RAM, and 48 KB is a meaningful bite out of the ~230
// KB we have left. Subclassing Adafruit_GFX and supplying our own PSRAM
// pointer keeps the whole font/text stack (setFont, setCursor, write,
// getTextBounds, drawRect…) while putting the pixels where they belong.
//
// SEPARATE FROM frame.cpp's BUFFER, deliberately. Both are 48 KB 1bpp frames
// destined for the same panel, and sharing one would save 48 KB of an 8 MB
// PSRAM — while creating a race where a /frame POST arriving mid-composite
// corrupts the slate. The memory is the cheapest thing in the trade.

#include <cstdint>

#include <Adafruit_GFX.h>

namespace framebuffer {

constexpr uint16_t WIDTH      = 800;
constexpr uint16_t HEIGHT     = 480;
constexpr uint16_t BYTES_ROW  = WIDTH / 8;          // 100
constexpr uint32_t TOTAL_BYTES = (uint32_t) BYTES_ROW * HEIGHT;  // 48000

// Adafruit_GFX surface writing straight into a caller-owned 1bpp buffer in
// our packing. Colour is 1 = ink (black), 0 = paper — matching protocol.md
// §1's byte sense, NOT GFX's usual 16-bit colour convention. Any non-zero
// colour is treated as ink so that callers passing a GFX colour constant
// still get sensible output.
class Canvas1 : public Adafruit_GFX {
public:
    Canvas1(uint8_t* buf, int16_t w, int16_t h)
        : Adafruit_GFX(w, h), buf_(buf) {}

    void drawPixel(int16_t x, int16_t y, uint16_t color) override;

    // Overridden for speed: the base class walks these pixel by pixel, and a
    // full-panel fill is 384,000 drawPixel calls. Byte-wise fills turn that
    // into 48,000 stores for the aligned interior.
    void fillScreen(uint16_t color) override;
    void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) override;
    void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) override;
    void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) override;

    uint8_t* buffer() { return buf_; }

    // Restrict all subsequent drawing to a rectangle. Adafruit_GFX has no
    // clipping of its own, so without this a field whose font is taller than
    // its box paints its descenders over whatever sits below — and with
    // multi-line wrapping that stops being a corner case, since a box one
    // line too short now spills a whole line rather than a few pixels.
    //
    // Clipping at drawPixel rather than pre-measuring means it holds for
    // every primitive, including glyph bitmaps we do not rasterise ourselves.
    void set_clip(int16_t x, int16_t y, int16_t w, int16_t h);
    void clear_clip();

private:
    uint8_t* buf_;
    int16_t  clip_x0_ = 0;
    int16_t  clip_y0_ = 0;
    int16_t  clip_x1_ = (int16_t) WIDTH  - 1;   // inclusive
    int16_t  clip_y1_ = (int16_t) HEIGHT - 1;
};

// Allocate the PSRAM buffer. Call once from setup(), after logging is up.
// Returns false on allocation failure — unlike frame::begin() this does NOT
// panic, because the editor path and the fire button remain useful without
// a compositor.
bool begin();

// The composite surface. Valid only after a successful begin().
Canvas1& canvas();

// Raw bytes, for handing to display::draw_partial_content().
uint8_t* bytes();

// Overwrite the whole composite with a 48,000-byte background. This is the
// first step of every render: template in, then fields on top.
void blit_background(const uint8_t* src);

// Fill with paper (all zero). Used when no template is loaded.
void clear();

bool ready();

}  // namespace framebuffer
