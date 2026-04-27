#pragma once

// POST /frame route + 48 KB PSRAM accumulator.
//
// Allocates one persistent 48 KB buffer in PSRAM at boot, accumulates the
// request body across ESPAsyncWebServer's onBody chunks at the right
// offsets, then synchronously hands the buffer to display::draw_frame().
// A busy flag rejects overlapping requests with 503 per protocol.md §2.1.

#include <cstdint>
#include <optional>

#include "status_json.h"  // for LastFrameMeta

class AsyncWebServer;

namespace frame {

// Allocates the PSRAM buffer. Call once after Serial/log are up so a
// failed allocation can be reported. Panics on failure — there is no
// recovery and the device has no purpose without it.
void begin();

// Wires GET/HEAD/POST/OPTIONS handlers for /frame onto the server.
// CORS headers must already be applied via the same shared helper used
// by /status; this module imports the helper from net.cpp via callback.
void register_routes(AsyncWebServer& server);

// Returns metadata for the most recently rendered frame, or nullopt if
// none has been received since boot. Read by /status.
std::optional<LastFrameMeta> last_meta();

}  // namespace frame
