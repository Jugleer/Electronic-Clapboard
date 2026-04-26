#include "log_server.h"

#include <Arduino.h>
#include <AsyncTCP.h>
#include <cstring>

#include "clap_log.h"

namespace {

constexpr uint16_t LOG_PORT          = 23;
constexpr size_t   DRAIN_CHUNK_BYTES = 1024;

AsyncServer*  server          = nullptr;
AsyncClient*  client          = nullptr;
ClapLogDrain  client_cursor   = {};
char          drain_buf[DRAIN_CHUNK_BYTES];

void on_client_disconnect(void* /*arg*/, AsyncClient* c) {
    if (c == client) {
        client = nullptr;
    }
    // AsyncTCP frees the AsyncClient itself after this callback returns.
    clap_log("[log] tail disconnected");
}

void on_client_error(void* arg, AsyncClient* c, int8_t /*err*/) {
    on_client_disconnect(arg, c);
}

void accept_client(AsyncClient* incoming) {
    if (client != nullptr && client->connected()) {
        // One tail at a time. Tell the second client politely and drop them.
        const char* msg =
            "[log] busy — another client is already tailing\r\n";
        incoming->write(msg, strlen(msg));
        incoming->close(true);
        return;
    }

    client = incoming;
    client_cursor = clap_log_make_cursor(/*replay_history=*/true);

    client->onDisconnect(on_client_disconnect);
    client->onError(on_client_error);

    const char* banner =
        "[log] connected — replaying buffered history, then live\r\n";
    client->write(banner, strlen(banner));

    clap_log("[log] tail connected from %s", incoming->remoteIP().toString().c_str());
}

void on_server_client(void* /*arg*/, AsyncClient* incoming) {
    accept_client(incoming);
}

}  // namespace

namespace log_server {

void begin() {
    if (server != nullptr) return;
    server = new AsyncServer(LOG_PORT);
    server->onClient(on_server_client, nullptr);
    server->begin();
    clap_log("[log] TCP log streamer listening on :%u", LOG_PORT);
}

void service() {
    if (client == nullptr || !client->connected()) return;

    // Cap drain at whatever the AsyncTCP send buffer can take right now.
    // If we drained more than that, the cursor would advance past bytes
    // we couldn't write — silent loss from the tail's perspective.
    const size_t budget = client->space();
    if (budget == 0) return;
    const size_t want = (budget < sizeof(drain_buf)) ? budget : sizeof(drain_buf);

    size_t n = clap_log_drain(client_cursor, drain_buf, want);

    if (client_cursor.bytes_lost > 0) {
        char notice[64];
        int len = snprintf(notice, sizeof(notice),
                           "\r\n[log] *** %u bytes lost ***\r\n",
                           static_cast<unsigned>(client_cursor.bytes_lost));
        if (len > 0 && client->space() >= static_cast<size_t>(len)) {
            client->write(notice, static_cast<size_t>(len));
        }
        client_cursor.bytes_lost = 0;
    }
    if (n > 0) {
        client->write(drain_buf, n);
    }
}

}  // namespace log_server
