#include "slate.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <cstring>

#include "clap_log.h"
#include "display.h"
#include "framebuffer.h"
#include "text_render.h"

namespace slate {

namespace {

char g_values[region::MAX_REGIONS][MAX_VALUE_CHARS + 1];

// Built-in default slate layout for an 800×480 panel.
//
// Laid out as a film slate rather than a debug grid, because it is what the
// device shows before anything is authored and a debug grid on a set is
// worse than useless. Left column carries the identifying numbers at hero
// size; the right column carries context.
//
// Field assignment matches the fields named when this was scoped: date,
// scene, take, recording number, description, plus spares.
const region::Template DEFAULT_TEMPLATE = {
    /*id=*/0,
    /*region_count=*/8,
    {
        // 0 — date, small, top-left
        { 0,  16,   8, 300,  34, region::FontId::Sans12,
          text_fit::HAlign::Left,   text_fit::VAlign::Middle, false },

        // 1 — production / title, inverted header bar across the top-right
        { 1, 330,   4, 454,  42, region::FontId::SansBold18,
          text_fit::HAlign::Center, text_fit::VAlign::Middle, true },

        // 2 — SCENE, hero
        { 2,  16,  60, 380, 150, region::FontId::SansBold24x2,
          text_fit::HAlign::Left,   text_fit::VAlign::Middle, false },

        // 3 — TAKE, hero, monospace so the digits don't shift
        { 3, 410,  60, 374, 150, region::FontId::MonoBold24,
          text_fit::HAlign::Right,  text_fit::VAlign::Middle, false },

        // 4 — shot description, the widest box, most likely to ellipsise
        { 4,  16, 224, 768,  60, region::FontId::SansBold24,
          text_fit::HAlign::Left,   text_fit::VAlign::Middle, false },

        // 5 — recording number
        { 5,  16, 296, 380,  50, region::FontId::SansBold18,
          text_fit::HAlign::Left,   text_fit::VAlign::Middle, false },

        // 6 — operator / camera
        { 6, 410, 296, 374,  50, region::FontId::Sans12,
          text_fit::HAlign::Right,  text_fit::VAlign::Middle, false },

        // 7 — notes, bottom strip
        { 7,  16, 360, 768,  44, region::FontId::Sans12,
          text_fit::HAlign::Left,   text_fit::VAlign::Top,    false },
    }
};

const char* value_ptrs[region::MAX_REGIONS];

}  // namespace

void begin() {
    clear_fields();
    // Fail loudly at boot rather than silently rendering nothing later. A
    // built-in constant that doesn't validate is a programming error, not a
    // runtime condition, so it is worth saying so once.
    if (!region::is_valid(DEFAULT_TEMPLATE)) {
        clap_log("[slate] BUILT-IN TEMPLATE IS INVALID — check region bounds");
    } else {
        clap_log("[slate] built-in template ready: %u regions",
                 (unsigned) DEFAULT_TEMPLATE.region_count);
    }
}

void set_field(uint8_t field_id, const char* text) {
    if (field_id >= region::MAX_REGIONS) return;
    if (!text) { g_values[field_id][0] = '\0'; return; }
    strncpy(g_values[field_id], text, MAX_VALUE_CHARS);
    g_values[field_id][MAX_VALUE_CHARS] = '\0';
}

void clear_fields() {
    for (uint8_t i = 0; i < region::MAX_REGIONS; ++i) g_values[i][0] = '\0';
}

const char* field(uint8_t field_id) {
    if (field_id >= region::MAX_REGIONS) return "";
    return g_values[field_id];
}

const region::Template& active_template() { return DEFAULT_TEMPLATE; }

uint32_t render_and_push() {
    if (!framebuffer::ready()) {
        clap_log("[slate] render skipped — no composite buffer");
        return 0;
    }

    // No template store until Phase 15, so the background is plain paper.
    // Once templates land this becomes a blit of the stored 48 KB raster.
    framebuffer::clear();

    for (uint8_t i = 0; i < region::MAX_REGIONS; ++i) value_ptrs[i] = g_values[i];
    text_render::draw_all(DEFAULT_TEMPLATE, value_ptrs);

    const uint32_t ms = display::draw_partial_content(framebuffer::bytes());
    clap_log("[slate] composited and pushed in %lu ms", (unsigned long) ms);
    return ms;
}

// ── Bench endpoint ────────────────────────────────────────────────────────

namespace {

// Deferred render: the panel blocks for 1.5-3.5 s and this handler runs on
// the AsyncTCP task. Responding first and rendering from loop() is the same
// discipline frame.cpp uses for its lock-in pass, and for the same reason —
// blocking the async task that long trips LWIP and the watchdog.
volatile bool g_render_pending = false;

void handle_slate(AsyncWebServerRequest* request) {
    uint8_t set_count = 0;
    for (uint8_t i = 0; i < region::MAX_REGIONS; ++i) {
        char key[4];
        snprintf(key, sizeof(key), "f%u", (unsigned) i);
        if (request->hasParam(key)) {
            set_field(i, request->getParam(key)->value().c_str());
            ++set_count;
        }
    }
    if (request->hasParam("clear")) { clear_fields(); set_count = 0; }

    g_render_pending = true;

    char body[128];
    snprintf(body, sizeof(body),
             "{\"ok\":true,\"fields_set\":%u,\"render\":\"queued\"}",
             (unsigned) set_count);
    AsyncWebServerResponse* r = request->beginResponse(200, "application/json", body);
    r->addHeader("Access-Control-Allow-Origin", "*");
    request->send(r);
}

}  // namespace

void service() {
    if (!g_render_pending) return;
    g_render_pending = false;
    render_and_push();
}

void register_routes(AsyncWebServer& server) {
    server.on("/slate", HTTP_GET, handle_slate);
}

}  // namespace slate
