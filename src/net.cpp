#include "net.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>

#include "clap_log.h"
#include "frame.h"
#include "secrets.h"
#include "status_json.h"

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0-dev"
#endif

namespace {

// CORS policy is dev-mode wide-open. Locked in docs/protocol.md §3.
// Tighten in v2.
constexpr const char* CORS_ORIGIN  = "*";
constexpr const char* CORS_METHODS = "GET, POST, OPTIONS";
constexpr const char* CORS_HEADERS = "Content-Type";

// Reconnect cadence. The Arduino-ESP32 SDK auto-reconnects internally, but
// a tight bad-password loop has been observed to starve loopTask on some
// core versions. Our own timer keeps service() cheap and lets us log.
constexpr uint32_t RECONNECT_BACKOFF_MS = 5000;

AsyncWebServer server(80);
bool           mdns_started        = false;
bool           was_connected       = false;
uint32_t       last_reconnect_ms   = 0;
uint32_t       boot_ms             = 0;

// /status pulls last-frame metadata from frame::last_meta() — populated
// by the /frame route after each successful render. Phase 1 left the
// optional empty here; Phase 2 routes the read through the frame module
// so net.cpp doesn't need to know about render bookkeeping.

void apply_cors_headers(AsyncWebServerResponse* response) {
    response->addHeader("Access-Control-Allow-Origin",  CORS_ORIGIN);
    response->addHeader("Access-Control-Allow-Methods", CORS_METHODS);
    response->addHeader("Access-Control-Allow-Headers", CORS_HEADERS);
}

void handle_status(AsyncWebServerRequest* request) {
    StatusInputs in;
    in.firmware_version = FIRMWARE_VERSION;
    in.uptime_ms        = millis();
    in.free_heap        = ESP.getFreeHeap();
    in.psram_free       = ESP.getFreePsram();
    in.last_frame       = frame::last_meta();

    const std::string body = build_status_json(in);

    AsyncWebServerResponse* response =
        request->beginResponse(200, "application/json", body.c_str());
    apply_cors_headers(response);
    request->send(response);
}

void handle_options(AsyncWebServerRequest* request) {
    // 204 No Content is the canonical response for a CORS preflight.
    // The String content overload is the lowest common denominator across
    // ESPAsyncWebServer forks; an empty body is fine.
    AsyncWebServerResponse* response =
        request->beginResponse(204, "text/plain", "");
    apply_cors_headers(response);
    request->send(response);
}

void start_http_server() {
    server.on("/status", HTTP_GET,     handle_status);
    server.on("/status", HTTP_OPTIONS, handle_options);

    // /frame routes (POST + OPTIONS) live in the frame module, but they
    // share the same CORS policy and onNotFound preflight catcher
    // registered below.
    frame::register_routes(server);

    server.onNotFound([](AsyncWebServerRequest* request) {
        // CORS preflight to a path we don't yet serve — answer it cleanly
        // so the browser doesn't surface a misleading network error.
        // Phase 2 replaces this with explicit /frame routes.
        if (request->method() == HTTP_OPTIONS) {
            handle_options(request);
            return;
        }
        AsyncWebServerResponse* response = request->beginResponse(
            404, "application/json",
            "{\"ok\":false,\"error\":\"not found\",\"code\":\"not_found\"}");
        apply_cors_headers(response);
        request->send(response);
    });

    server.begin();
    clap_log("[net] HTTP server listening on :80");
}

void start_mdns() {
    if (mdns_started) return;
    if (!MDNS.begin(MDNS_HOSTNAME)) {
        clap_log("[net] mDNS failed to start (will retry on next reconnect)");
        return;
    }
    MDNS.addService("http", "tcp", 80);
    mdns_started = true;
    clap_log("[net] mDNS started: http://%s.local/", MDNS_HOSTNAME);
}

void stop_mdns() {
    if (!mdns_started) return;
    MDNS.end();
    mdns_started = false;
}

void on_connected() {
    clap_log("[net] WiFi connected: ip=%s rssi=%ddBm ssid=\"%s\"",
             WiFi.localIP().toString().c_str(),
             WiFi.RSSI(),
             WIFI_SSID);
    start_mdns();
}

void on_disconnected() {
    clap_log("[net] WiFi link down");
    stop_mdns();
}

void kick_reconnect() {
    const uint32_t now = millis();
    if (now - last_reconnect_ms < RECONNECT_BACKOFF_MS) return;
    last_reconnect_ms = now;
    clap_log("[net] reconnect attempt");
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

}  // namespace

namespace net {

void begin() {
    boot_ms = millis();

    WiFi.persistent(false);
    WiFi.setAutoReconnect(true);
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(MDNS_HOSTNAME);

    clap_log("[net] connecting to \"%s\"...", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    last_reconnect_ms = millis();

    start_http_server();
}

void service() {
    const bool connected = (WiFi.status() == WL_CONNECTED);

    if (connected && !was_connected) {
        on_connected();
    } else if (!connected && was_connected) {
        on_disconnected();
    }

    if (!connected) {
        kick_reconnect();
    }

    was_connected = connected;
}

}  // namespace net
