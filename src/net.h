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

// Block (with a timeout) until the Wi-Fi STA reports CONNECTED. Returns
// true if connected before timeout, false otherwise. Used at boot to
// gather the IP address for the splash screen.
bool wait_for_connection(uint32_t timeout_ms);

// Last-known IP address as a printable C-string. Returns "0.0.0.0" if
// the radio has never associated. Pointer is valid until the next call.
const char* current_ip();

// mDNS hostname (e.g. "clapboard"). Pointer is valid for the lifetime
// of the program.
const char* current_hostname();

}  // namespace net
