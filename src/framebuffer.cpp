#include "framebuffer.h"

#include <Arduino.h>
#include <esp_heap_caps.h>
#include <cstring>
#include <new>

#include "clap_log.h"

namespace framebuffer {

namespace {

uint8_t* g_buf = nullptr;
Canvas1* g_canvas = nullptr;

// Placement storage so the canvas can be constructed after the buffer is
// allocated without a heap allocation of its own.
alignas(Canvas1) uint8_t g_canvas_storage[sizeof(Canvas1)];

inline bool in_bounds(int16_t x, int16_t y) {
    return x >= 0 && y >= 0 && x < (int16_t) WIDTH && y < (int16_t) HEIGHT;
}

}  // namespace

void Canvas1::drawPixel(int16_t x, int16_t y, uint16_t color) {
    // Adafruit_GFX applies rotation via getRotation(); we never rotate, so
    // the coordinates arrive panel-native. Bounds-check anyway: text drawn
    // near a region edge routinely asks for pixels outside the panel, and
    // silently clipping is exactly the behaviour the fixed-size/clip model
    // promises.
    if (!in_bounds(x, y)) return;

    uint8_t* p = buf_ + (uint32_t) y * BYTES_ROW + (uint32_t)(x >> 3);
    const uint8_t mask = (uint8_t)(0x80 >> (x & 7));   // MSB = leftmost pixel
    if (color) *p = (uint8_t)(*p | mask);
    else       *p = (uint8_t)(*p & ~mask);
}

void Canvas1::fillScreen(uint16_t color) {
    memset(buf_, color ? 0xFF : 0x00, TOTAL_BYTES);
}

void Canvas1::drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) {
    if (y < 0 || y >= (int16_t) HEIGHT || w <= 0) return;
    if (x < 0) { w += x; x = 0; }
    if (x >= (int16_t) WIDTH) return;
    if (x + w > (int16_t) WIDTH) w = (int16_t) WIDTH - x;
    if (w <= 0) return;

    uint8_t* row = buf_ + (uint32_t) y * BYTES_ROW;
    int16_t  x0  = x;
    int16_t  x1  = (int16_t)(x + w - 1);

    const int16_t byte0 = (int16_t)(x0 >> 3);
    const int16_t byte1 = (int16_t)(x1 >> 3);

    // Leading partial byte, whole bytes, trailing partial byte. The whole-
    // byte run is the point of this override — a 780 px line becomes ~97
    // stores instead of 780 read-modify-writes.
    if (byte0 == byte1) {
        const uint8_t m = (uint8_t)((0xFF >> (x0 & 7)) & (0xFF << (7 - (x1 & 7))));
        if (color) row[byte0] |= m; else row[byte0] &= (uint8_t)~m;
        return;
    }
    const uint8_t lead = (uint8_t)(0xFF >> (x0 & 7));
    if (color) row[byte0] |= lead; else row[byte0] &= (uint8_t)~lead;

    if (byte1 > byte0 + 1) {
        memset(row + byte0 + 1, color ? 0xFF : 0x00, (size_t)(byte1 - byte0 - 1));
    }
    const uint8_t trail = (uint8_t)(0xFF << (7 - (x1 & 7)));
    if (color) row[byte1] |= trail; else row[byte1] &= (uint8_t)~trail;
}

void Canvas1::drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) {
    if (x < 0 || x >= (int16_t) WIDTH || h <= 0) return;
    if (y < 0) { h += y; y = 0; }
    if (y >= (int16_t) HEIGHT) return;
    if (y + h > (int16_t) HEIGHT) h = (int16_t) HEIGHT - y;
    if (h <= 0) return;

    const uint8_t mask = (uint8_t)(0x80 >> (x & 7));
    uint8_t* p = buf_ + (uint32_t) y * BYTES_ROW + (uint32_t)(x >> 3);
    for (int16_t i = 0; i < h; ++i, p += BYTES_ROW) {
        if (color) *p = (uint8_t)(*p | mask);
        else       *p = (uint8_t)(*p & ~mask);
    }
}

void Canvas1::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    if (w <= 0 || h <= 0) return;
    if (y < 0) { h += y; y = 0; }
    if (y + h > (int16_t) HEIGHT) h = (int16_t) HEIGHT - y;
    for (int16_t i = 0; i < h; ++i) {
        drawFastHLine(x, (int16_t)(y + i), w, color);
    }
}

bool begin() {
    if (g_buf) return true;

    g_buf = static_cast<uint8_t*>(
        heap_caps_malloc(TOTAL_BYTES, MALLOC_CAP_SPIRAM));
    if (!g_buf) {
        clap_log("[fb] PSRAM alloc of %lu bytes FAILED — compositor disabled",
                 (unsigned long) TOTAL_BYTES);
        return false;
    }
    memset(g_buf, 0x00, TOTAL_BYTES);

    g_canvas = new (g_canvas_storage) Canvas1(g_buf, (int16_t) WIDTH, (int16_t) HEIGHT);
    // GFX wraps text at the right edge by default, which for a fixed-size
    // clip model would silently push an overlong field onto the next line
    // and out of its box. We do our own fitting; wrapping must be off.
    g_canvas->setTextWrap(false);

    clap_log("[fb] composite buffer up: %ux%u, %lu bytes PSRAM",
             (unsigned) WIDTH, (unsigned) HEIGHT, (unsigned long) TOTAL_BYTES);
    return true;
}

Canvas1& canvas() { return *g_canvas; }

uint8_t* bytes() { return g_buf; }

bool ready() { return g_buf != nullptr; }

void blit_background(const uint8_t* src) {
    if (!g_buf || !src) return;
    memcpy(g_buf, src, TOTAL_BYTES);
}

void clear() {
    if (!g_buf) return;
    memset(g_buf, 0x00, TOTAL_BYTES);
}

}  // namespace framebuffer
