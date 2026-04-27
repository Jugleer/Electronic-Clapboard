#pragma once

// Thin wrapper around GxEPD2 for the 7.5" V2 panel.
//
// Owns the EPD instance, panel-power pin, and init sequence so the rest of
// the firmware can render frames without touching driver internals. Pure
// Arduino-side; not linked into [env:native].

#include <cstdint>

namespace display {

// One-time setup: power the panel, init the driver, blank the framebuffer.
// Safe to call from setup() after MOSFET gates are LOW. Slow (~1 s).
void begin();

// Render a 48000-byte 1-bit MSB frame to the panel. Layout matches
// docs/protocol.md §1: 1 = ink, MSB-first, scanlines top-to-bottom.
//
// `full_refresh = true` triggers a full window refresh that clears
// ghosting (~3-4 s); false uses a partial refresh of the whole panel
// (~1-2 s, still some ghosting after many updates).
//
// Returns elapsed milliseconds for the render call. Blocking.
uint32_t draw_frame(const uint8_t* buf, bool full_refresh);

}  // namespace display
