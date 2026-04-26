#pragma once

// Phase 1 network layer: Wi-Fi STA + mDNS + HTTP server (one route).
//
// Owns connection lifecycle and the AsyncWebServer instance. Routes call
// into status_json.h to render the /status payload — keeping JSON formatting
// out of this translation unit so it can be unit-tested on the host.

#include <cstdint>

namespace net {

// Bring up the radio and start the HTTP server. Non-blocking: the connect
// happens asynchronously, and reconnects are managed in service().
void begin();

// Call from loop(). Polls the connection state, kicks reconnects with a
// backoff, and announces transitions over Serial. Cheap when idle.
void service();

}  // namespace net
