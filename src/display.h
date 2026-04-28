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

// Drop the EPD logic-rail enable (PIN_EPD_PWR LOW). The bistable display
// retains whatever was last drawn — the panel goes dark on the e-paper
// driver-board ICs but the visible image stays put. Used by power::
// enter_sleep() to bring idle current toward the buck quiescent floor.
// After this call the panel is unsafe to drive until display::begin()
// re-runs (which re-powers and re-inits the driver).
void power_off();

// Render a "boot" splash showing firmware version + IP + a hint line.
// Called once after net::begin() completes so the panel reflects what
// was just flashed without waiting for the first /frame request.
void show_boot_screen(const char* firmware_version,
                      const char* ip_address,
                      const char* hostname);

// Render a 48000-byte 1-bit MSB frame to the panel via the partial-
// refresh waveform. ~1.5–2 s. The partial waveform paints with full
// black saturation and does NOT trigger the deep-refresh post-cycle
// that lifts ghosting (and saturation) on this panel.
uint32_t draw_partial_content(const uint8_t* buf);

// Run a full-window refresh painting all-white only — no image
// content. ~3.5 s. Used as the first half of a "wipe + content"
// full-refresh sequence: the deep-refresh post-cycle runs against an
// all-white framebuffer (nothing to lift), then the caller follows up
// with a `draw_partial_content` to paint the actual image at full
// saturation. Splitting the sequence lets the partial pass happen
// outside the HTTP handler so the AsyncTCP task isn't blocked for the
// combined ~5–6 s, which on this board hits LWIP / brownout limits
// and causes a chip reset.
uint32_t draw_full_white();

}  // namespace display
