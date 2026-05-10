#include "screensaver.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <driver/rtc_io.h>
#include <esp_heap_caps.h>
#include <esp_sleep.h>

#include <string>

#include "clap_log.h"
#include "config.h"
#include "display.h"
#include "screensaver_manifest.h"
#include "screensaver_state.h"
#include "wallclock.h"

// Phase 10. Module overview lives in screensaver.h. This file is the
// Arduino-side glue: LittleFS, NVS, HTTP routes, and the timer-wake
// render path.

namespace {

constexpr const char* FS_ROOT          = "/screensaver";
constexpr const char* MANIFEST_PATH    = "/screensaver/manifest.json";
constexpr const char* MANIFEST_TMP     = "/screensaver/manifest.json.tmp";
constexpr const char* PARTITION_LABEL  = "slate_data";

// NVS keys. Two-level: top-level Preferences namespace "ss" with
// per-attribute keys. Counter is the only thing rewritten frequently;
// the config is rewritten only on POST /screensaver/config so a
// shorter TTL on the flash there is fine.
constexpr const char* NVS_NAMESPACE    = "ss";
constexpr const char* NVS_RR_COUNTER   = "rr";
constexpr const char* NVS_INTERVAL_S   = "interval";
constexpr const char* NVS_PICKER_MODE  = "picker";
constexpr const char* NVS_ENABLED      = "enabled";

constexpr uint32_t FRAME_BYTES_EXPECTED = 48000;

screensaver_state::StateMachine g_sm;

// In-memory mirror of slot display names. The state machine tracks
// occupied slots only; names live here so /screensaver/manifest can
// surface them. Slot index → name. Empty string = name not set.
std::string g_slot_names[screensaver_state::MAX_SLOTS];

// Slot last-modified timestamps in device millis(). Reset to 0 on
// every boot — they're a "freshness within this awake session" hint
// for the editor, not a wall-clock value.
uint32_t g_slot_updated_ms[screensaver_state::MAX_SLOTS] = {0};

// Single-flight render lock. /frame and /screensaver/{frame,rename,
// delete,config} all serialise on this. ESPAsyncWebServer dispatches
// every handler from the AsyncTCP task so plain `volatile bool` is
// race-free for our purposes; concurrent access from the main loop
// (deferred lockin) is the only foreign reader and it only reads
// after the handler clears the flag.
volatile bool g_busy = false;

bool ensure_fs_mounted() {
    static bool mounted = false;
    if (mounted) return true;
    // Mount with format-on-fail so the very first boot after the
    // Phase-10 partition table change doesn't brick — LittleFS
    // formats the (newly-renamed-from-spiffs) slate_data region into
    // a clean filesystem and we lose nothing because there was
    // nothing in there.
    if (!LittleFS.begin(/*formatOnFail=*/true,
                        /*basePath=*/FS_ROOT,
                        /*maxOpenFiles=*/4,
                        /*partitionLabel=*/PARTITION_LABEL)) {
        clap_log("[screensaver] FATAL: LittleFS.begin failed on partition %s",
                 PARTITION_LABEL);
        return false;
    }
    mounted = true;
    clap_log("[screensaver] LittleFS mounted on %s (used %u / total %u bytes)",
             PARTITION_LABEL,
             (unsigned) LittleFS.usedBytes(),
             (unsigned) LittleFS.totalBytes());
    return true;
}

void slot_path(uint8_t slot, char* out, size_t out_len) {
    snprintf(out, out_len, "/screensaver/slot_%u.bin", (unsigned) slot);
}

void slot_tmp_path(uint8_t slot, char* out, size_t out_len) {
    snprintf(out, out_len, "/screensaver/slot_%u.bin.tmp", (unsigned) slot);
}

// --- Manifest reconciliation ----------------------------------------------

// JSON parsing of the manifest is intentionally hand-rolled — the
// document is small and the field set is fixed. Walks the file twice:
// once to find name strings keyed by "slot": N, once to collect
// runtime config (enabled / cycle_interval_s / picker_mode / counter).
// We don't care if the on-disk file is "perfectly" valid JSON; we
// only need the fields we wrote. Anything else is overwritten on the
// next manifest write.
void load_persisted_names_from_disk() {
    if (!LittleFS.exists(MANIFEST_PATH)) return;
    File f = LittleFS.open(MANIFEST_PATH, "r");
    if (!f) return;
    String body = f.readString();
    f.close();
    // Crude but bounded: scan for {"slot":N,"name":"..."} pairs.
    // A torn write could leave invalid JSON; we tolerate it because
    // the on-disk file is rebuilt on the next write anyway.
    int pos = 0;
    while (pos < (int) body.length()) {
        const int slot_idx = body.indexOf("\"slot\":", pos);
        if (slot_idx < 0) break;
        const int num_start = slot_idx + 7;
        char* end = nullptr;
        const long n = strtol(body.c_str() + num_start, &end, 10);
        if (n < 0 || n >= screensaver_state::MAX_SLOTS) {
            pos = num_start + 1;
            continue;
        }
        const int name_idx = body.indexOf("\"name\":\"", num_start);
        if (name_idx < 0) break;
        const int name_start = name_idx + 8;
        const int name_end = body.indexOf("\"", name_start);
        if (name_end < 0) break;
        g_slot_names[n] = std::string(
            body.c_str() + name_start, name_end - name_start);
        pos = name_end + 1;
    }
}

void reconcile_manifest_vs_disk() {
    // Walk LittleFS for slot_<n>.bin files; populate the state
    // machine's occupied set. For any slot file that exists but has
    // no name entry, register a default name "slot N".
    screensaver_state::OccupiedSlots occupied;
    File dir = LittleFS.open(FS_ROOT);
    if (dir && dir.isDirectory()) {
        File entry = dir.openNextFile();
        while (entry) {
            const String name = entry.name();
            // entry.name() returns a leaf (no path prefix on
            // arduino-esp32 v2.x LittleFS). Match "slot_<n>.bin".
            int n = -1;
            if (name.startsWith("slot_") && name.endsWith(".bin")) {
                const int dot = name.indexOf('.');
                if (dot > 5) {
                    const String num = name.substring(5, dot);
                    n = num.toInt();
                }
            }
            if (n >= 0 && n < screensaver_state::MAX_SLOTS &&
                entry.size() == FRAME_BYTES_EXPECTED) {
                occupied.add(static_cast<uint8_t>(n));
                if (g_slot_names[n].empty()) {
                    char buf[16];
                    snprintf(buf, sizeof(buf), "slot %d", n);
                    g_slot_names[n] = buf;
                }
            } else if (n >= 0) {
                clap_log("[screensaver] reconcile: dropping malformed %s (size=%u)",
                         name.c_str(), (unsigned) entry.size());
                LittleFS.remove(String(FS_ROOT) + "/" + name);
            }
            entry = dir.openNextFile();
        }
    }
    // Drop name entries whose slot is no longer on disk (orphan
    // manifest entries).
    for (uint8_t s = 0; s < screensaver_state::MAX_SLOTS; s++) {
        if (!occupied.contains(s)) g_slot_names[s].clear();
    }

    // Apply via the state machine. The sm clamps interval bounds and
    // force-disables empty cycles per protocol §2.6.
    screensaver_state::SchedulerInputs in;
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, /*readOnly=*/true);
    in.cycle_interval_s = prefs.getUInt(NVS_INTERVAL_S,
                                        screensaver_state::DEFAULT_INTERVAL_S);
    in.enabled          = prefs.getBool(NVS_ENABLED, false);
    in.picker_mode      = prefs.getUChar(NVS_PICKER_MODE, 0) == 1
        ? screensaver_state::PickerMode::WallclockHybrid
        : screensaver_state::PickerMode::RoundRobin;
    g_sm.restore_round_robin_counter(prefs.getUInt(NVS_RR_COUNTER, 0));
    prefs.end();
    in.occupied = occupied;
    g_sm.apply_config(in);
}

void persist_round_robin_counter() {
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, /*readOnly=*/false);
    prefs.putUInt(NVS_RR_COUNTER, g_sm.round_robin_counter());
    prefs.end();
}

void persist_config() {
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, /*readOnly=*/false);
    prefs.putUInt(NVS_INTERVAL_S, g_sm.cycle_interval_s());
    prefs.putBool(NVS_ENABLED, g_sm.is_enabled());
    prefs.putUChar(NVS_PICKER_MODE,
                   g_sm.picker_mode() ==
                       screensaver_state::PickerMode::WallclockHybrid
                       ? 1 : 0);
    prefs.end();
}

// --- Atomic manifest write -------------------------------------------------

void build_manifest_inputs(screensaver_manifest::ManifestInputs& in) {
    in.enabled              = g_sm.is_enabled();
    in.cycle_interval_s     = g_sm.cycle_interval_s();
    in.min_cycle_interval_s = screensaver_state::MIN_CYCLE_INTERVAL_S;
    in.max_cycle_interval_s = screensaver_state::MAX_CYCLE_INTERVAL_S;
    in.max_slots            = screensaver_state::MAX_SLOTS;
    in.picker_mode          = g_sm.picker_mode();
    in.rtc_synced           = wallclock::is_synced();
    in.picker_mode_actual   = g_sm.picker_mode_actual(in.rtc_synced);
    in.current_slot         = g_sm.current_slot();
    in.last_tick_ms         = g_sm.last_tick_ms();
    in.next_tick_ms         = g_sm.next_tick_ms_optional();
    in.slots.clear();
    const auto& occ = g_sm.occupied();
    for (uint8_t s = 0; s < screensaver_state::MAX_SLOTS; s++) {
        if (!occ.contains(s)) continue;
        screensaver_manifest::SlotInfo si;
        si.slot          = s;
        si.name          = g_slot_names[s];
        si.bytes         = FRAME_BYTES_EXPECTED;
        si.updated_at_ms = g_slot_updated_ms[s];
        in.slots.push_back(si);
    }
}

bool write_manifest_atomic() {
    screensaver_manifest::ManifestInputs in;
    build_manifest_inputs(in);
    const std::string body = build_manifest_json(in);

    File f = LittleFS.open(MANIFEST_TMP, "w", /*create=*/true);
    if (!f) {
        clap_log("[screensaver] manifest tmp open failed");
        return false;
    }
    const size_t wrote = f.write(
        reinterpret_cast<const uint8_t*>(body.data()), body.size());
    f.close();
    if (wrote != body.size()) {
        LittleFS.remove(MANIFEST_TMP);
        return false;
    }
    if (LittleFS.exists(MANIFEST_PATH)) {
        LittleFS.remove(MANIFEST_PATH);
    }
    return LittleFS.rename(MANIFEST_TMP, MANIFEST_PATH);
}

// --- Slot I/O --------------------------------------------------------------

bool read_slot(uint8_t slot, uint8_t* dst) {
    char path[32];
    slot_path(slot, path, sizeof(path));
    File f = LittleFS.open(path, "r");
    if (!f) return false;
    const size_t got = f.read(dst, FRAME_BYTES_EXPECTED);
    f.close();
    return got == FRAME_BYTES_EXPECTED;
}

bool write_slot_atomic(uint8_t slot, const uint8_t* src) {
    char tmp[32];
    char dst[32];
    slot_tmp_path(slot, tmp, sizeof(tmp));
    slot_path(slot, dst, sizeof(dst));
    File f = LittleFS.open(tmp, "w", /*create=*/true);
    if (!f) {
        clap_log("[screensaver] slot %u tmp open failed", (unsigned) slot);
        return false;
    }
    const size_t wrote = f.write(src, FRAME_BYTES_EXPECTED);
    f.close();
    if (wrote != FRAME_BYTES_EXPECTED) {
        LittleFS.remove(tmp);
        return false;
    }
    if (LittleFS.exists(dst)) LittleFS.remove(dst);
    return LittleFS.rename(tmp, dst);
}

// --- HTTP helpers ----------------------------------------------------------

void cors(AsyncWebServerResponse* r) {
    r->addHeader("Access-Control-Allow-Origin",  "*");
    r->addHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    r->addHeader("Access-Control-Allow-Headers", "Content-Type");
}

void send_json(AsyncWebServerRequest* req, int status,
               const std::string& body) {
    AsyncWebServerResponse* r =
        req->beginResponse(status, "application/json", body.c_str());
    cors(r);
    req->send(r);
}

void send_err(AsyncWebServerRequest* req, int status,
              const char* slug, const char* message) {
    std::string body = "{\"ok\":false,\"error\":\"";
    body += message;
    body += "\",\"code\":\"";
    body += slug;
    body += "\"}";
    AsyncWebServerResponse* r = req->beginResponse(status,
                                                   "application/json",
                                                   body.c_str());
    if (status == 503) r->addHeader("Retry-After", "1");
    cors(r);
    req->send(r);
}

void send_busy(AsyncWebServerRequest* req) {
    send_err(req, 503, "busy", "render in progress");
}

void send_ok_manifest(AsyncWebServerRequest* req) {
    screensaver_manifest::ManifestInputs in;
    build_manifest_inputs(in);
    send_json(req, 200, build_manifest_json(in));
}

bool parse_slot_query(AsyncWebServerRequest* req, uint8_t& slot_out) {
    if (!req->hasParam("slot")) return false;
    const long n = req->getParam("slot")->value().toInt();
    if (n < 0 || n >= screensaver_state::MAX_SLOTS) return false;
    slot_out = static_cast<uint8_t>(n);
    return true;
}

bool valid_name(const String& name) {
    return name.length() >= 1 && name.length() <= 32;
}

void on_options(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse(204, "text/plain", "");
    cors(r);
    req->send(r);
}

// --- /screensaver/manifest GET --------------------------------------------

void handle_get_manifest(AsyncWebServerRequest* req) {
    send_ok_manifest(req);
}

// --- /screensaver/frame POST ----------------------------------------------

struct FrameReqCtx {
    bool        owns_busy   = false;
    bool        rejected    = false;
    int         http_status = 200;
    const char* slug        = "";
    const char* msg         = "";
    uint32_t    bytes_received = 0;
    uint8_t     slot        = 0;
    String      name;
    bool        body_started = false;
    uint8_t*    buf         = nullptr;
};

FrameReqCtx* push_ctx(AsyncWebServerRequest* req) {
    auto* c = static_cast<FrameReqCtx*>(req->_tempObject);
    if (!c) {
        c = new FrameReqCtx();
        req->_tempObject = c;
        req->onDisconnect([c, req]() {
            if (c->owns_busy) g_busy = false;
            if (c->buf) heap_caps_free(c->buf);
            delete c;
            req->_tempObject = nullptr;
        });
    }
    return c;
}

void on_push_body(AsyncWebServerRequest* req,
                  uint8_t* data, size_t len, size_t index, size_t total) {
    FrameReqCtx* c = push_ctx(req);
    if (index == 0) {
        c->body_started = true;
        // Validate Content-Type and Content-Length up front. Per §2.6
        // these reuse the same slugs as /frame: bad_content_type,
        // bad_size, too_large.
        std::string ctype;
        if (req->hasHeader("Content-Type")) {
            ctype = req->header("Content-Type").c_str();
        }
        if (ctype.find("application/octet-stream") == std::string::npos) {
            c->rejected = true; c->http_status = 415;
            c->slug = "bad_content_type"; c->msg = "expected octet-stream";
            return;
        }
        if (total > FRAME_BYTES_EXPECTED) {
            c->rejected = true; c->http_status = 413;
            c->slug = "too_large"; c->msg = "body exceeds 48000 bytes";
            return;
        }
        if (total != FRAME_BYTES_EXPECTED) {
            c->rejected = true; c->http_status = 400;
            c->slug = "bad_size"; c->msg = "Content-Length must equal 48000";
            return;
        }
        if (!parse_slot_query(req, c->slot)) {
            c->rejected = true; c->http_status = 400;
            c->slug = "bad_slot"; c->msg = "slot must be 0..49";
            return;
        }
        if (req->hasParam("name")) {
            c->name = req->getParam("name")->value();
            if (!valid_name(c->name)) {
                c->rejected = true; c->http_status = 400;
                c->slug = "bad_name"; c->msg = "name must be 1..32 chars";
                return;
            }
        }
        if (g_busy) {
            c->rejected = true; c->http_status = 503;
            c->slug = "busy"; c->msg = "render in progress";
            return;
        }
        g_busy = true;
        c->owns_busy = true;
        c->buf = static_cast<uint8_t*>(
            heap_caps_malloc(FRAME_BYTES_EXPECTED, MALLOC_CAP_SPIRAM));
        if (!c->buf) {
            c->rejected = true; c->http_status = 500;
            c->slug = "internal"; c->msg = "PSRAM alloc failed";
            return;
        }
    }
    if (c->rejected || !c->buf) return;
    if (index + len > FRAME_BYTES_EXPECTED) {
        c->rejected = true; c->http_status = 413;
        c->slug = "too_large"; c->msg = "body overshoot";
        return;
    }
    memcpy(c->buf + index, data, len);
    c->bytes_received = static_cast<uint32_t>(index + len);
}

void on_push_complete(AsyncWebServerRequest* req) {
    FrameReqCtx* c = push_ctx(req);
    if (c->rejected) {
        if (c->owns_busy) { g_busy = false; c->owns_busy = false; }
        send_err(req, c->http_status, c->slug, c->msg);
        return;
    }
    if (!c->body_started || c->bytes_received != FRAME_BYTES_EXPECTED) {
        if (c->owns_busy) { g_busy = false; c->owns_busy = false; }
        send_err(req, 400, "bad_size",
                 "body did not accumulate to 48000 bytes");
        return;
    }
    // Atomic write: tmp → rename. Per protocol §2.6 a partial write
    // mid-power-cut leaves the previous slot intact.
    const bool wrote = write_slot_atomic(c->slot, c->buf);
    if (!wrote) {
        if (c->owns_busy) { g_busy = false; c->owns_busy = false; }
        send_err(req, 500, "internal", "slot write failed");
        return;
    }
    // Update in-memory state. apply_config recomputes current_slot.
    if (c->name.length() > 0) {
        g_slot_names[c->slot] = std::string(c->name.c_str());
    } else if (g_slot_names[c->slot].empty()) {
        char buf[16];
        snprintf(buf, sizeof(buf), "slot %u", (unsigned) c->slot);
        g_slot_names[c->slot] = buf;
    }
    g_slot_updated_ms[c->slot] = millis();

    screensaver_state::OccupiedSlots occ = g_sm.occupied();
    occ.add(c->slot);
    screensaver_state::SchedulerInputs in;
    in.enabled          = g_sm.is_enabled();
    in.cycle_interval_s = g_sm.cycle_interval_s();
    in.picker_mode      = g_sm.picker_mode();
    in.occupied         = occ;
    g_sm.apply_config(in);
    write_manifest_atomic();
    persist_config();

    if (c->owns_busy) { g_busy = false; c->owns_busy = false; }

    std::string body = "{\"ok\":true,\"slot\":";
    body += std::to_string((unsigned) c->slot);
    body += ",\"bytes\":48000,\"name\":";
    if (g_slot_names[c->slot].empty()) {
        body += "null";
    } else {
        body += "\"";
        body += g_slot_names[c->slot];
        body += "\"";
    }
    body += "}";
    send_json(req, 200, body);
}

// --- /screensaver/frame DELETE --------------------------------------------

void handle_delete(AsyncWebServerRequest* req) {
    if (g_busy) { send_busy(req); return; }
    uint8_t slot;
    if (!parse_slot_query(req, slot)) {
        send_err(req, 400, "bad_slot", "slot must be 0..49");
        return;
    }
    if (!g_sm.occupied().contains(slot)) {
        send_err(req, 404, "slot_empty", "slot is not occupied");
        return;
    }
    char path[32];
    slot_path(slot, path, sizeof(path));
    LittleFS.remove(path);
    g_slot_names[slot].clear();
    g_slot_updated_ms[slot] = 0;

    screensaver_state::OccupiedSlots occ = g_sm.occupied();
    occ.remove(slot);
    screensaver_state::SchedulerInputs in;
    in.enabled          = g_sm.is_enabled();
    in.cycle_interval_s = g_sm.cycle_interval_s();
    in.picker_mode      = g_sm.picker_mode();
    in.occupied         = occ;
    g_sm.apply_config(in);
    write_manifest_atomic();
    persist_config();

    std::string body = "{\"ok\":true,\"slot\":";
    body += std::to_string((unsigned) slot);
    body += ",\"remaining\":";
    body += std::to_string((unsigned) occ.count());
    body += "}";
    send_json(req, 200, body);
}

// --- /screensaver/rename POST ---------------------------------------------

void handle_rename(AsyncWebServerRequest* req) {
    if (g_busy) { send_busy(req); return; }
    uint8_t slot;
    if (!parse_slot_query(req, slot)) {
        send_err(req, 400, "bad_slot", "slot must be 0..49");
        return;
    }
    if (!req->hasParam("name")) {
        send_err(req, 400, "bad_name", "name is required");
        return;
    }
    const String name = req->getParam("name")->value();
    if (!valid_name(name)) {
        send_err(req, 400, "bad_name", "name must be 1..32 chars");
        return;
    }
    if (!g_sm.occupied().contains(slot)) {
        send_err(req, 404, "slot_empty", "slot is not occupied");
        return;
    }
    g_slot_names[slot] = std::string(name.c_str());
    write_manifest_atomic();

    std::string body = "{\"ok\":true,\"slot\":";
    body += std::to_string((unsigned) slot);
    body += ",\"name\":\"";
    body += g_slot_names[slot];
    body += "\"}";
    send_json(req, 200, body);
}

// --- /screensaver/config POST ---------------------------------------------

// Minimal hand-rolled JSON parser for the three-key config body. The
// document is well-defined and bounded: { "enabled": bool?,
// "cycle_interval_s": number?, "picker_mode": string? }. Anything
// else is rejected as bad_config.
struct ConfigPatch {
    bool                                       have_enabled = false;
    bool                                       enabled      = false;
    bool                                       have_interval = false;
    uint32_t                                   interval_s   = 0;
    bool                                       have_picker  = false;
    screensaver_state::PickerMode              picker = screensaver_state::PickerMode::RoundRobin;
};

bool parse_config_body(const String& body, ConfigPatch& out) {
    // Find each of the three keys; we don't enforce strict JSON
    // structure beyond the shapes we care about. Order-independent.
    {
        const int k = body.indexOf("\"enabled\"");
        if (k >= 0) {
            const int colon = body.indexOf(':', k);
            if (colon < 0) return false;
            int p = colon + 1;
            while (p < (int) body.length() && (body[p] == ' ' || body[p] == '\t')) p++;
            if (body.substring(p, p + 4) == "true") {
                out.have_enabled = true; out.enabled = true;
            } else if (body.substring(p, p + 5) == "false") {
                out.have_enabled = true; out.enabled = false;
            } else {
                return false;
            }
        }
    }
    {
        const int k = body.indexOf("\"cycle_interval_s\"");
        if (k >= 0) {
            const int colon = body.indexOf(':', k);
            if (colon < 0) return false;
            int p = colon + 1;
            while (p < (int) body.length() && (body[p] == ' ' || body[p] == '\t')) p++;
            char* end = nullptr;
            const long n = strtol(body.c_str() + p, &end, 10);
            if (end == body.c_str() + p) return false;
            if (n < 0) return false;
            out.have_interval = true;
            out.interval_s = static_cast<uint32_t>(n);
        }
    }
    {
        const int k = body.indexOf("\"picker_mode\"");
        if (k >= 0) {
            const int colon = body.indexOf(':', k);
            if (colon < 0) return false;
            const int q1 = body.indexOf('"', colon);
            if (q1 < 0) return false;
            const int q2 = body.indexOf('"', q1 + 1);
            if (q2 < 0) return false;
            const String value = body.substring(q1 + 1, q2);
            if (value == "round_robin") {
                out.have_picker = true;
                out.picker = screensaver_state::PickerMode::RoundRobin;
            } else if (value == "wallclock_hybrid") {
                out.have_picker = true;
                out.picker = screensaver_state::PickerMode::WallclockHybrid;
            } else {
                return false;
            }
        }
    }
    return true;
}

void on_config_body(AsyncWebServerRequest* req,
                    uint8_t* data, size_t len, size_t index, size_t total) {
    auto* body = static_cast<String*>(req->_tempObject);
    if (!body) {
        body = new String();
        body->reserve(total + 1);
        req->_tempObject = body;
        req->onDisconnect([body, req]() {
            delete body;
            req->_tempObject = nullptr;
        });
    }
    body->concat((const char*) data, len);
    (void) index;
    (void) total;
}

void on_config_complete(AsyncWebServerRequest* req) {
    auto* body = static_cast<String*>(req->_tempObject);
    if (!body) {
        send_err(req, 400, "bad_config", "empty body");
        return;
    }
    if (g_busy) { send_busy(req); return; }
    std::string ctype;
    if (req->hasHeader("Content-Type")) {
        ctype = req->header("Content-Type").c_str();
    }
    if (ctype.find("application/json") == std::string::npos) {
        send_err(req, 415, "bad_content_type", "expected application/json");
        return;
    }
    ConfigPatch patch;
    if (!parse_config_body(*body, patch)) {
        send_err(req, 400, "bad_config", "could not parse body");
        return;
    }
    // Build the next config from current state + patch.
    screensaver_state::SchedulerInputs in;
    in.enabled          = patch.have_enabled  ? patch.enabled    : g_sm.is_enabled();
    in.cycle_interval_s = patch.have_interval ? patch.interval_s : g_sm.cycle_interval_s();
    in.picker_mode      = patch.have_picker   ? patch.picker     : g_sm.picker_mode();
    in.occupied         = g_sm.occupied();
    if (g_sm.validate_config(in) != screensaver_state::ConfigVerdict::Ok) {
        send_err(req, 400, "bad_config", "interval out of range");
        return;
    }
    g_sm.apply_config(in);
    write_manifest_atomic();
    persist_config();

    send_ok_manifest(req);
}

}  // namespace

namespace screensaver {

void begin() {
    if (!ensure_fs_mounted()) return;
    load_persisted_names_from_disk();
    reconcile_manifest_vs_disk();
    // protocol §2.6: cycle is paused while awake on a wake-button
    // wake. The cycle resumes when the user long-presses to sleep.
    g_sm.pause();
    write_manifest_atomic();
    clap_log("[screensaver] ready: %u slots occupied, interval=%u s, "
             "picker=%s, enabled=%d",
             (unsigned) g_sm.occupied().count(),
             (unsigned) g_sm.cycle_interval_s(),
             g_sm.picker_mode() == screensaver_state::PickerMode::WallclockHybrid
                 ? "wallclock_hybrid" : "round_robin",
             g_sm.is_enabled() ? 1 : 0);
}

void register_routes(AsyncWebServer& server) {
    server.on("/screensaver/manifest", HTTP_GET,     handle_get_manifest);
    server.on("/screensaver/manifest", HTTP_OPTIONS, on_options);

    server.on("/screensaver/frame", HTTP_POST,
              on_push_complete,
              nullptr,
              on_push_body);
    server.on("/screensaver/frame", HTTP_DELETE,  handle_delete);
    server.on("/screensaver/frame", HTTP_OPTIONS, on_options);

    server.on("/screensaver/rename", HTTP_POST,    handle_rename);
    server.on("/screensaver/rename", HTTP_OPTIONS, on_options);

    server.on("/screensaver/config", HTTP_POST,
              on_config_complete,
              nullptr,
              on_config_body);
    server.on("/screensaver/config", HTTP_OPTIONS, on_options);
}

bool should_arm_timer() {
    return g_sm.is_enabled() && g_sm.occupied().count() > 0;
}

uint32_t cycle_interval_s() {
    return g_sm.cycle_interval_s();
}

void tick_and_resleep() {
    if (!ensure_fs_mounted()) {
        // Nothing we can do — drop straight back to sleep on a 60 s
        // timer so the device isn't a brick.
        clap_log("[screensaver] tick: FS mount failed; sleeping 60 s");
        esp_sleep_enable_timer_wakeup(60ULL * 1000ULL * 1000ULL);
        esp_deep_sleep_start();
        // unreachable
        for (;;) {}
    }
    load_persisted_names_from_disk();
    reconcile_manifest_vs_disk();

    // Resume from paused state: a wake-button awake session paused
    // the cycle, but timer-wakes are the cycle ticking, so unpause.
    g_sm.resume();

    if (g_sm.occupied().count() == 0 || !g_sm.is_enabled()) {
        clap_log("[screensaver] tick: nothing to render (occupied=%u, enabled=%d); "
                 "going back to sleep without re-arming",
                 (unsigned) g_sm.occupied().count(),
                 g_sm.is_enabled() ? 1 : 0);
        // No timer wake — drop into ext0-only sleep so only the wake
        // button can bring us back.
        digitalWrite(PIN_LED_GATE, LOW);
        digitalWrite(PIN_SOLENOID_GATE, LOW);
        display::power_off();
        const gpio_num_t wake_pin = static_cast<gpio_num_t>(PIN_WAKE_BUTTON);
        esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
        esp_sleep_enable_ext0_wakeup(wake_pin, 0);
        rtc_gpio_pullup_en(wake_pin);
        rtc_gpio_pulldown_dis(wake_pin);
        esp_deep_sleep_start();
        for (;;) {}  // unreachable
    }

    // Pick the next slot.
    g_sm.advance(wallclock::is_synced(), wallclock::unix_seconds());
    auto slot_opt = g_sm.current_slot();
    if (!slot_opt.has_value()) {
        clap_log("[screensaver] tick: pick returned no slot; sleeping");
        esp_sleep_enable_timer_wakeup(
            (uint64_t) g_sm.cycle_interval_s() * 1000000ULL);
        esp_deep_sleep_start();
        for (;;) {}
    }
    const uint8_t slot = *slot_opt;

    // Allocate the render buffer in PSRAM (8 MB free, 48 KB rounding
    // noise) and read the slot bytes.
    uint8_t* buf = static_cast<uint8_t*>(
        heap_caps_malloc(FRAME_BYTES_EXPECTED, MALLOC_CAP_SPIRAM));
    if (!buf || !read_slot(slot, buf)) {
        clap_log("[screensaver] tick: slot %u read failed; sleeping", (unsigned) slot);
        if (buf) heap_caps_free(buf);
        esp_sleep_enable_timer_wakeup(
            (uint64_t) g_sm.cycle_interval_s() * 1000000ULL);
        esp_deep_sleep_start();
        for (;;) {}
    }

    // Render. Timer-wake: AsyncTCP isn't running, so we don't need
    // the deferred-lockin split — the back-to-back full-white +
    // partial-content sequence is safe synchronously.
    display::begin();
    const uint32_t white_ms = display::draw_full_white();
    const uint32_t partial_ms = display::draw_partial_content(buf);
    heap_caps_free(buf);
    g_sm.note_tick(millis());
    persist_round_robin_counter();
    clap_log("[screensaver] painted slot %u (white=%u ms, partial=%u ms)",
             (unsigned) slot,
             (unsigned) white_ms,
             (unsigned) partial_ms);

    // Re-arm and back to sleep. Same MOSFET-LOW + EPD-power-off
    // sequence as power::enter_sleep(), plus the timer.
    digitalWrite(PIN_LED_GATE, LOW);
    digitalWrite(PIN_SOLENOID_GATE, LOW);
    display::power_off();
    Serial.flush();
    delay(50);

    const gpio_num_t wake_pin = static_cast<gpio_num_t>(PIN_WAKE_BUTTON);
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
    esp_sleep_enable_ext0_wakeup(wake_pin, 0);
    rtc_gpio_pullup_en(wake_pin);
    rtc_gpio_pulldown_dis(wake_pin);
    esp_sleep_enable_timer_wakeup(
        (uint64_t) g_sm.cycle_interval_s() * 1000000ULL);
    esp_deep_sleep_start();
    for (;;) {}  // unreachable
}

void enter_timer_sleep() {
    digitalWrite(PIN_LED_GATE, LOW);
    digitalWrite(PIN_SOLENOID_GATE, LOW);
    display::power_off();
    Serial.flush();
    delay(50);
    const gpio_num_t wake_pin = static_cast<gpio_num_t>(PIN_WAKE_BUTTON);
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
    esp_sleep_enable_ext0_wakeup(wake_pin, 0);
    rtc_gpio_pullup_en(wake_pin);
    rtc_gpio_pulldown_dis(wake_pin);
    esp_sleep_enable_timer_wakeup(
        (uint64_t) g_sm.cycle_interval_s() * 1000000ULL);
    esp_deep_sleep_start();
    for (;;) {}
}

}  // namespace screensaver
