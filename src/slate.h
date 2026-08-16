#pragma once

// Phase 14: the slate — current field values plus the active template,
// composited on demand and pushed to the panel.
//
// This is deliberately small. Phase 16 grows it into the CAN transaction
// consumer (reassembly, CRC validation, patch semantics, CLAP_ACK); right
// now it exists so Phase 14's renderer can actually be pointed at the panel
// and photographed, which acceptance test 5 requires. Building the renderer
// with no way to run it would mean handing over untested rendering code.
//
// The built-in default template is not throwaway scaffolding. It is what the
// device shows before anything has been authored, and it gives the Phase 16
// CAN path something to render into on day one — so a template push becomes
// an upgrade rather than a precondition.

#include <cstdint>

#include "region.h"

class AsyncWebServer;

namespace slate {

// Field value storage: 8 fields × 32 chars + NUL, matching
// can_frames::MAX_FIELD_CHARS. Kept here rather than in can.cpp because the
// values outlive any one CAN transaction — patch semantics mean a field
// persists until something replaces it.
constexpr uint8_t MAX_VALUE_CHARS = 32;

void begin();

// Replace one field. Truncates at MAX_VALUE_CHARS. Does not render — the
// caller decides when a transaction is complete, which for CAN is the
// CLAP_COMMIT and for the bench endpoint is the end of the query string.
void set_field(uint8_t field_id, const char* text);

// Clear every field to empty. Not called on a template change: fields are
// data, templates are presentation, and losing the scene number because
// someone re-authored the layout would be surprising.
void clear_fields();

const char* field(uint8_t field_id);

// The template currently being rendered into — the built-in default until
// one is loaded from LittleFS.
const region::Template& active_template();
uint8_t                 active_template_id();
bool                    active_is_builtin();

// Load a stored template and make it active, pulling its background raster
// into PSRAM. Returns false if absent, corrupt, or PSRAM is exhausted; the
// previously active template is left untouched in every failure case.
bool select_template(uint8_t id);

// Composite and push: blank the buffer, draw every field, hand the bytes to
// the panel. Returns the panel render time in ms, or 0 if the compositor is
// not available.
//
// Blocking for 1.5-3.5 s — this is the e-paper, not the code. Callers on the
// AsyncTCP task must respond to the client BEFORE calling, or the watchdog
// will fire; see the deferred-lockin discipline in frame.cpp for the same
// hazard handled the same way.
uint32_t render_and_push();

// GET /slate?f0=...&f1=... — bench surface for Phase 14. Sets any field
// named in the query string, then queues a composite. Add `clear` to blank
// every field first.
void register_routes(AsyncWebServer& server);

// Runs the queued composite. Call from loop(). The HTTP handler cannot
// render inline: the panel blocks for seconds and the handler runs on the
// AsyncTCP task, which trips LWIP and the watchdog — the same hazard
// frame.cpp defers its lock-in pass for.
void service();

}  // namespace slate
