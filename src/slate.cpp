#include "slate.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <cstring>

#include <esp_heap_caps.h>
#include <ctime>

#include "can.h"
#include "clap_log.h"
#include "display.h"
#include "framebuffer.h"
#include "mode_state.h"
#include "screensaver.h"
#include "template_store.h"
#include "template_wire.h"
#include "text_render.h"

namespace slate {

namespace {

// Field VALUES are not stored here. can_link owns them (clap_txn::Txn),
// because a value's lifetime is a CAN transaction's, not a render's — patch
// semantics mean a field persists until something replaces it, and keeping a
// second copy in sync with the transaction machine would be a standing
// opportunity for the panel and the ack to disagree about what was applied.
// slate:: just reads through.

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

// Deferred render: the panel blocks for 1.5-3.5 s and the HTTP handlers run
// on the AsyncTCP task while CAN commits arrive on the RX task. Both queue
// here and loop() does the work — the same discipline frame.cpp uses for its
// lock-in pass, and for the same reason: blocking either task that long
// trips LWIP and the watchdog.
//
// Doubles as the BUSY signal for CLAP_COMMIT, which is why it is volatile:
// written from AsyncTCP and the CAN RX task, read from loop().
volatile bool     g_render_pending = false;
volatile uint16_t g_last_render_ms = 0;

// Template a pending CAN commit asked for. 0xFF means "no change" — loop()
// only switches when a commit named a different one, so a /slate bench call
// or a screensaver transition never disturbs the active template.
constexpr uint8_t  NO_TEMPLATE_REQUEST = 0xFF;
volatile uint8_t   g_requested_template = NO_TEMPLATE_REQUEST;

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

    // Hand can_link the three things it needs to answer a CLAP_COMMIT
    // without knowing anything about rendering. Passing function pointers
    // rather than having can.cpp include slate.h keeps the dependency
    // one-way: the transport does not get to reach into the compositor.
    can_link::SlateHooks hooks{};
    hooks.busy = []() -> bool { return g_render_pending; };
    hooks.template_available = [](uint8_t id) -> bool {
        if (!framebuffer::ready()) return false;
        // Template 0 always resolves: it is either a stored template or the
        // built-in default. Anything else must actually be in flash — a
        // bitmask lookup, no filesystem access, because this runs on the
        // CAN RX task.
        return id == 0 || template_store::exists(id);
    };
    hooks.request_render = [](uint8_t id) -> uint16_t {
        // Record the requested template; loop() switches to it before
        // rendering. Selection reads LittleFS and 48 KB of PSRAM, neither of
        // which belongs on the RX task.
        g_requested_template = id;
        g_render_pending     = true;
        return g_last_render_ms;
    };
    can_link::set_slate_hooks(hooks);
    can_link::set_active_template(g_active_id);

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
    can_link::set_field(field_id, text);
}

void clear_fields() { can_link::clear_fields(); }

const char* field(uint8_t field_id) { return can_link::field(field_id); }

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

    for (uint8_t i = 0; i < region::MAX_REGIONS; ++i) {
        value_ptrs[i] = can_link::field(i);
    }
    text_render::draw_all(g_active, value_ptrs);

    const uint32_t ms = display::draw_partial_content(framebuffer::bytes());
    g_last_render_ms  = (uint16_t)(ms > 65535 ? 65535 : ms);
    clap_log("[slate] composited template %u%s and pushed in %lu ms",
             (unsigned) g_active_id,
             g_active_is_builtin ? " (built-in)" : "",
             (unsigned long) ms);
    return ms;
}

// ── Bench endpoint ────────────────────────────────────────────────────────

namespace {

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

// ── Phase 17: mode arbitration ────────────────────────────────────────────

namespace {

uint32_t g_next_cycle_ms = 0;

void format_date(char* out, size_t n) {
    const uint64_t us = can_link::wall_us();
    const time_t   t  = (time_t)(us / 1000000ULL);
    struct tm tmv;
    gmtime_r(&t, &tmv);
    strftime(out, n, "%Y-%m-%d", &tmv);
}

void enter_scene() {
    // Blank every field on entry. Carrying the previous session's take
    // number into a new one is worse than showing nothing: an operator
    // glancing at the slate would read a stale number as current.
    can_link::clear_fields();

    if (can_link::time_synced()) {
        char date[16];
        format_date(date, sizeof(date));
        can_link::set_field(DATE_FIELD_ID, date);
    }
    clap_log("[slate] mode → scene (fields cleared, date autofilled)");
    g_render_pending = true;
}

void enter_screensaver() {
    clap_log("[slate] mode → screensaver");
    if (screensaver::has_slates()) {
        screensaver::paint_current_slate();
        g_next_cycle_ms = millis() + screensaver::cycle_interval_s() * 1000UL;
    } else {
        // No slates stored. Leave whatever is on the panel rather than
        // blanking it — a white panel is indistinguishable from a dead
        // device, and the point of screensaver mode is to SIGNAL a dead
        // link, not to imitate one.
        clap_log("[slate] no screensaver slates stored; panel left as-is");
        g_next_cycle_ms = 0;
    }
}

}  // namespace

void service() {
    // No CAN driver means no link to have an opinion about, so mode
    // arbitration does not apply — the device is on a bench, not a robot,
    // and /slate must keep working exactly as it did before Phase 17.
    // Arbitrating anyway would park a CAN-less board in screensaver mode
    // permanently and silently swallow every render request.
    if (!can_link::stats().driver_up) {
        if (!g_render_pending) return;
        g_render_pending = false;
        g_requested_template = NO_TEMPLATE_REQUEST;
        render_and_push();
        return;
    }

    // Mode first: a transition may itself queue a render.
    const auto step = can_link::mode_step();
    if (step.changed) {
        if (step.mode == mode_state::Mode::Scene) enter_scene();
        else                                     enter_screensaver();
    }

    if (step.mode == mode_state::Mode::Screensaver) {
        if (g_next_cycle_ms != 0 &&
            (int32_t)(millis() - g_next_cycle_ms) >= 0) {
            screensaver::paint_next_slate();
            g_next_cycle_ms = millis() + screensaver::cycle_interval_s() * 1000UL;
        }
        // A queued scene render is dropped rather than deferred: by the time
        // the link returns, the fields it was going to draw are stale.
        g_render_pending = false;
        return;
    }

    if (!g_render_pending) return;
    g_render_pending = false;

    // Honour a CAN commit's template_id before compositing. Doing this here
    // rather than on the RX task keeps LittleFS and the 48 KB raster read
    // off a real-time path.
    const uint8_t want = g_requested_template;
    g_requested_template = NO_TEMPLATE_REQUEST;
    if (want != NO_TEMPLATE_REQUEST && want != g_active_id) {
        if (select_template(want)) {
            can_link::set_active_template(want);
            clap_log("[slate] switched to template %u on CAN request",
                     (unsigned) want);
        } else if (want == 0) {
            // Template 0 with nothing stored means the built-in default,
            // which is already active. Not an error.
        } else {
            // template_available() said yes and the load failed anyway —
            // a corrupt file that passed the bitmask. Render with what we
            // have rather than blanking; the heartbeat's last_error and the
            // log carry the fault.
            clap_log("[slate] template %u load FAILED after availability "
                     "check passed — rendering with template %u",
                     (unsigned) want, (unsigned) g_active_id);
        }
    }

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
