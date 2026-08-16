#include "slate.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <cstring>

#include <esp_heap_caps.h>

#include "clap_log.h"
#include "display.h"
#include "framebuffer.h"
#include "template_store.h"
#include "template_wire.h"
#include "text_render.h"

namespace slate {

namespace {

char g_values[region::MAX_REGIONS][MAX_VALUE_CHARS + 1];

// The template currently driving renders. Starts as the built-in default and
// is replaced when one is loaded from flash. Held by value (a few hundred
// bytes) rather than by pointer into the store, so a re-upload mid-render
// cannot swap the geometry out from under draw_all().
region::Template g_active;
bool             g_active_is_builtin = true;
uint8_t          g_active_id         = 0;

// Background raster for the active template, or nullptr when the built-in
// default is showing (which renders on plain paper). 48 KB of PSRAM,
// allocated once on first template load.
uint8_t* g_background = nullptr;

// Upload accumulator for POST /template. Separate from both frame::'s buffer
// and the composite buffer for the same reason those are separate from each
// other: an upload arriving mid-render must not be able to corrupt what is
// on the panel.
uint8_t* g_upload = nullptr;

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
    g_active            = DEFAULT_TEMPLATE;
    g_active_is_builtin = true;
    g_active_id         = 0;

    // Adopt a stored template 0 if one exists, so a reboot comes back with
    // whatever was last authored rather than reverting to the built-in and
    // silently changing the slate's appearance mid-shoot.
    if (template_store::exists(0)) {
        if (select_template(0)) {
            clap_log("[slate] adopted stored template 0 on boot");
        }
    }
}

bool select_template(uint8_t id) {
    region::Template t{};
    if (!template_store::load(id, t)) return false;

    if (!g_background) {
        g_background = static_cast<uint8_t*>(
            heap_caps_malloc(template_wire::RASTER_BYTES, MALLOC_CAP_SPIRAM));
        if (!g_background) {
            clap_log("[slate] PSRAM alloc for background FAILED — "
                     "template %u not selected", (unsigned) id);
            return false;
        }
    }
    if (!template_store::load_raster(id, g_background)) {
        clap_log("[slate] raster read failed for template %u", (unsigned) id);
        return false;
    }

    g_active            = t;
    g_active_is_builtin = false;
    g_active_id         = id;
    return true;
}

uint8_t active_template_id() { return g_active_id; }
bool    active_is_builtin()  { return g_active_is_builtin; }

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

const region::Template& active_template() { return g_active; }

uint32_t render_and_push() {
    if (!framebuffer::ready()) {
        clap_log("[slate] render skipped — no composite buffer");
        return 0;
    }

    // Background first, fields on top. The built-in default has no raster,
    // so it renders on plain paper.
    if (!g_active_is_builtin && g_background) {
        framebuffer::blit_background(g_background);
    } else {
        framebuffer::clear();
    }

    for (uint8_t i = 0; i < region::MAX_REGIONS; ++i) value_ptrs[i] = g_values[i];
    text_render::draw_all(g_active, value_ptrs);

    const uint32_t ms = display::draw_partial_content(framebuffer::bytes());
    clap_log("[slate] composited template %u%s and pushed in %lu ms",
             (unsigned) g_active_id,
             g_active_is_builtin ? " (built-in)" : "",
             (unsigned long) ms);
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

// ── POST /template?id=N ───────────────────────────────────────────────────
// Body is exactly template_wire::BODY_BYTES: 48,000 raster + 100 trailer.
//
// Accumulation mirrors frame.cpp: ESPAsyncWebServer delivers the body in
// chunks with an offset, and the total is checked on the FIRST chunk so an
// oversized upload is rejected before a single byte is copied. Deciding late
// would mean either allocating for the worst case or overrunning the buffer.

uint32_t g_upload_len   = 0;
bool     g_upload_bad   = false;
uint8_t  g_upload_id    = 0;

void handle_template_body(AsyncWebServerRequest* request, uint8_t* data,
                          size_t len, size_t index, size_t total) {
    if (index == 0) {
        g_upload_len = 0;
        g_upload_bad = false;
        g_upload_id  = 0;

        if (request->hasParam("id")) {
            g_upload_id = (uint8_t) request->getParam("id")->value().toInt();
        }
        if (g_upload_id >= template_wire::MAX_TEMPLATES) {
            clap_log("[tmpl] upload rejected: id %u out of range",
                     (unsigned) g_upload_id);
            g_upload_bad = true;
            return;
        }
        if (total != template_wire::BODY_BYTES) {
            clap_log("[tmpl] upload rejected: Content-Length %u != %lu",
                     (unsigned) total, (unsigned long) template_wire::BODY_BYTES);
            g_upload_bad = true;
            return;
        }
        if (!g_upload) {
            g_upload = static_cast<uint8_t*>(
                heap_caps_malloc(template_wire::BODY_BYTES, MALLOC_CAP_SPIRAM));
            if (!g_upload) {
                clap_log("[tmpl] upload rejected: PSRAM alloc failed");
                g_upload_bad = true;
                return;
            }
        }
    }

    if (g_upload_bad || !g_upload) return;
    if (index + len > template_wire::BODY_BYTES) { g_upload_bad = true; return; }

    memcpy(g_upload + index, data, len);
    g_upload_len = (uint32_t)(index + len);
}

void handle_template_done(AsyncWebServerRequest* request) {
    char body[192];
    int  code = 200;

    if (g_upload_bad || g_upload_len != template_wire::BODY_BYTES) {
        code = 400;
        snprintf(body, sizeof(body),
                 "{\"ok\":false,\"error\":\"bad_upload\",\"expected_bytes\":%lu,"
                 "\"received\":%lu}",
                 (unsigned long) template_wire::BODY_BYTES,
                 (unsigned long) g_upload_len);
    } else if (!template_store::store(g_upload_id, g_upload, g_upload_len)) {
        // store() logs the specific reason; the client gets a generic
        // rejection because the useful detail (which region was invalid) is
        // in the serial/TCP log where the author is already looking.
        code = 400;
        snprintf(body, sizeof(body),
                 "{\"ok\":false,\"error\":\"rejected\",\"id\":%u}",
                 (unsigned) g_upload_id);
    } else {
        // Adopt it immediately: the author's next action is to look at the
        // panel, and requiring a second call to activate would make the
        // common case a two-step.
        const bool selected = select_template(g_upload_id);
        if (selected) g_render_pending = true;
        snprintf(body, sizeof(body),
                 "{\"ok\":true,\"id\":%u,\"regions\":%u,\"selected\":%s,"
                 "\"render\":\"queued\"}",
                 (unsigned) g_upload_id,
                 (unsigned) active_template().region_count,
                 selected ? "true" : "false");
    }

    AsyncWebServerResponse* r = request->beginResponse(code, "application/json", body);
    r->addHeader("Access-Control-Allow-Origin", "*");
    request->send(r);
}

void handle_templates_list(AsyncWebServerRequest* request) {
    const uint8_t mask = template_store::present_mask();
    char body[256];
    int  n = snprintf(body, sizeof(body),
                      "{\"ok\":true,\"max\":%u,\"active\":%u,\"builtin\":%s,"
                      "\"stored\":[",
                      (unsigned) template_wire::MAX_TEMPLATES,
                      (unsigned) active_template_id(),
                      active_is_builtin() ? "true" : "false");
    bool first = true;
    for (uint8_t i = 0; i < template_wire::MAX_TEMPLATES; ++i) {
        if (!(mask & (1u << i))) continue;
        n += snprintf(body + n, sizeof(body) - n, "%s%u", first ? "" : ",",
                      (unsigned) i);
        first = false;
    }
    snprintf(body + n, sizeof(body) - n, "]}");

    AsyncWebServerResponse* r = request->beginResponse(200, "application/json", body);
    r->addHeader("Access-Control-Allow-Origin", "*");
    request->send(r);
}

void handle_options(AsyncWebServerRequest* request) {
    AsyncWebServerResponse* r = request->beginResponse(204);
    r->addHeader("Access-Control-Allow-Origin",  "*");
    r->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    r->addHeader("Access-Control-Allow-Headers", "Content-Type");
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
    server.on("/slate", HTTP_OPTIONS, handle_options);

    server.on("/template", HTTP_POST, handle_template_done, nullptr,
              handle_template_body);
    server.on("/template", HTTP_OPTIONS, handle_options);

    server.on("/templates", HTTP_GET, handle_templates_list);
    server.on("/templates", HTTP_OPTIONS, handle_options);
}

}  // namespace slate
