#include "frame.h"

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <esp_heap_caps.h>

#include "clap_log.h"
#include "display.h"
#include "frame_validate.h"

namespace {

// One-shot PSRAM allocation for the 48 KB frame body. Reused across every
// request — per Phase 2 design note, allocate-once avoids fragmentation
// and per-request thrash. /status reports ~8.36 MB PSRAM free, so failure
// here is a programmer error, not a runtime condition we can recover from.
uint8_t* g_buf = nullptr;

// Async server can dispatch requests on AsyncTCP's task. The render itself
// is synchronous and blocking inside the request handler — we accept the
// AsyncTCP block and use this flag to fail fast on overlapping requests
// rather than queuing them. Set on the very first onBody chunk; cleared in
// the response handler after render completes (or after an early reject).
volatile bool g_busy = false;

// Per-request scratch — owned by ESPAsyncWebServer via request->_tempObject.
// Carries the early-rejection verdict (if any) and the running byte count
// from onBody to the final response handler so we don't validate twice.
struct ReqCtx {
    FrameValidation verdict         = FrameValidation::Ok;
    bool            owns_busy_flag  = false;
    bool            rejected_busy   = false;
    bool            body_started    = false;
    uint32_t        bytes_received  = 0;
};

std::optional<LastFrameMeta> g_last_meta;

void apply_cors_headers(AsyncWebServerResponse* response) {
    // Mirror of net.cpp's policy. Duplicated rather than refactored
    // because hoisting it would mean restructuring net.cpp's anonymous
    // namespace; protocol.md §3 is the source of truth either way.
    response->addHeader("Access-Control-Allow-Origin",  "*");
    response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type");
}

void send_error(AsyncWebServerRequest* request, FrameValidation v) {
    const FrameError e = to_error(v);
    String body = "{\"ok\":false,\"error\":\"";
    body += e.message;
    body += "\",\"code\":\"";
    body += e.slug;
    body += "\"}";
    AsyncWebServerResponse* response =
        request->beginResponse(e.http_status, "application/json", body);
    apply_cors_headers(response);
    request->send(response);
}

void send_busy(AsyncWebServerRequest* request) {
    AsyncWebServerResponse* response = request->beginResponse(
        503, "application/json",
        "{\"ok\":false,\"error\":\"render in progress\",\"code\":\"busy\"}");
    response->addHeader("Retry-After", "1");
    apply_cors_headers(response);
    request->send(response);
}

ReqCtx* ctx(AsyncWebServerRequest* request) {
    auto* c = static_cast<ReqCtx*>(request->_tempObject);
    if (c == nullptr) {
        c = new ReqCtx();
        request->_tempObject = c;
        request->onDisconnect([c, request]() {
            // Defensive: if the client drops mid-upload, the response
            // handler may never run. Make sure we don't strand g_busy.
            if (c->owns_busy_flag) {
                g_busy = false;
                clap_log("[frame] client disconnected mid-upload; busy cleared");
            }
            delete c;
            request->_tempObject = nullptr;
        });
    }
    return c;
}

void on_body(AsyncWebServerRequest* request,
             uint8_t* data, size_t len, size_t index, size_t total) {
    ReqCtx* c = ctx(request);

    if (index == 0) {
        c->body_started = true;
        // First chunk — validate Content-Type and Content-Length up front
        // so we can refuse without buffering a single byte if the request
        // is malformed. AsyncWebServerRequest exposes total via the `total`
        // arg here (== Content-Length when it was set).
        std::string ctype;
        if (request->hasHeader("Content-Type")) {
            ctype = request->header("Content-Type").c_str();
        }
        FrameValidation v = validate_content_type(ctype);
        if (v == FrameValidation::Ok) {
            v = validate_content_length(static_cast<uint32_t>(total));
        }
        if (v != FrameValidation::Ok) {
            c->verdict = v;
            return;  // skip the copy; response handler will send the error
        }

        // Single-flight guard: refuse before copying any bytes.
        if (g_busy) {
            c->rejected_busy = true;
            return;
        }
        g_busy = true;
        c->owns_busy_flag = true;
    }

    if (c->rejected_busy || c->verdict != FrameValidation::Ok) {
        return;  // already decided to reject; drop body bytes
    }

    if (index + len > FRAME_EXPECTED_BYTES) {
        // Defensive: AsyncWebServer should already cap based on total,
        // but body chunking in some forks has been observed to overshoot.
        c->verdict = FrameValidation::TooLarge;
        return;
    }
    memcpy(g_buf + index, data, len);
    c->bytes_received = static_cast<uint32_t>(index + len);
}

void on_request_complete(AsyncWebServerRequest* request) {
    ReqCtx* c = ctx(request);

    // Path 1: validation failed somewhere along the way.
    if (c->verdict != FrameValidation::Ok) {
        if (c->owns_busy_flag) g_busy = false;
        c->owns_busy_flag = false;
        send_error(request, c->verdict);
        return;
    }

    // Path 2: busy at first-chunk time, never owned the flag.
    if (c->rejected_busy) {
        send_busy(request);
        return;
    }

    // Path 3: empty-body POST — no chunks were ever delivered, so we
    // never validated content-length. Validate now and reject.
    if (!c->body_started) {
        std::string ctype;
        if (request->hasHeader("Content-Type")) {
            ctype = request->header("Content-Type").c_str();
        }
        FrameValidation v = validate_content_type(ctype);
        if (v == FrameValidation::Ok) {
            v = validate_content_length(
                static_cast<uint32_t>(request->contentLength()));
        }
        send_error(request, v == FrameValidation::Ok
                                ? FrameValidation::BadSize
                                : v);
        return;
    }

    // Path 4: chunks didn't accumulate to the expected size (truncated
    // upload, e.g. Content-Length lied or client disconnected gracefully
    // after a partial body). Treat as a size mismatch.
    if (c->bytes_received != FRAME_EXPECTED_BYTES) {
        clap_log("[frame] body underrun: got=%u expected=%u",
                 (unsigned) c->bytes_received,
                 (unsigned) FRAME_EXPECTED_BYTES);
        g_busy = false;
        c->owns_busy_flag = false;
        send_error(request, FrameValidation::BadSize);
        return;
    }

    // Happy path: render synchronously and respond with timing.
    // Match the strict "?full=1" semantics from frame_validate via the
    // server's pre-parsed query bag — anything else (absent, "0", "true")
    // is partial-refresh.
    bool full_refresh = false;
    if (request->hasParam("full")) {
        full_refresh = (request->getParam("full")->value() == "1");
    }
    const uint32_t t_start    = millis();
    const uint32_t render_ms  = display::draw_frame(g_buf, full_refresh);
    const uint32_t finished   = millis();

    LastFrameMeta meta;
    meta.at_ms        = finished;
    meta.bytes        = FRAME_EXPECTED_BYTES;
    meta.render_ms    = render_ms;
    meta.full_refresh = full_refresh;
    g_last_meta = meta;

    g_busy = false;
    c->owns_busy_flag = false;

    String body = "{\"ok\":true,\"bytes\":48000,\"render_ms\":";
    body += String(render_ms);
    body += ",\"full_refresh\":";
    body += (full_refresh ? "true" : "false");
    body += "}";
    AsyncWebServerResponse* response =
        request->beginResponse(200, "application/json", body);
    apply_cors_headers(response);
    request->send(response);

    clap_log("[frame] rendered bytes=48000 full=%d render_ms=%u (handler t=%u)",
             full_refresh ? 1 : 0,
             (unsigned) render_ms,
             (unsigned) (finished - t_start));
}

void on_options(AsyncWebServerRequest* request) {
    AsyncWebServerResponse* response =
        request->beginResponse(204, "text/plain", "");
    apply_cors_headers(response);
    request->send(response);
}

}  // namespace

namespace frame {

void begin() {
    g_buf = static_cast<uint8_t*>(
        heap_caps_malloc(FRAME_EXPECTED_BYTES, MALLOC_CAP_SPIRAM));
    if (g_buf == nullptr) {
        clap_log("[frame] FATAL: PSRAM allocation of %u bytes failed",
                 (unsigned) FRAME_EXPECTED_BYTES);
        // No recovery path — without the buffer there is no /frame.
        // Halt loudly so the user sees the failure on serial/TCP log.
        while (true) {
            delay(1000);
            clap_log("[frame] halted: cannot allocate frame buffer");
        }
    }
    memset(g_buf, 0x00, FRAME_EXPECTED_BYTES);  // start all-white
    clap_log("[frame] PSRAM buffer ready: %u bytes",
             (unsigned) FRAME_EXPECTED_BYTES);
}

void register_routes(AsyncWebServer& server) {
    server.on("/frame", HTTP_POST,
              on_request_complete,                       // request handler
              nullptr,                                   // no file uploads
              on_body);                                  // body chunks
    server.on("/frame", HTTP_OPTIONS, on_options);
}

std::optional<LastFrameMeta> last_meta() {
    return g_last_meta;
}

}  // namespace frame
