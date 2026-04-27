#include <Arduino.h>

#include "clap_log.h"
#include "config.h"
#include "display.h"
#include "frame.h"
#include "log_server.h"
#include "net.h"

// Phase 2 firmware entry point. Phase 1 brought up Wi-Fi, mDNS, /status,
// and the TCP log tail; Phase 2 adds the data plane: a 48 KB PSRAM frame
// buffer, the EPD render path, and POST /frame. The typewriter env
// (src/main.cpp under [env:esp32s3]) remains the SPI regression canary
// until Phase 4 of the firmware refactor.

static void hold_high_current_rails_low() {
    // CLAUDE.md non-negotiable: MOSFET gates must default LOW before any
    // other init runs. ESP32 GPIOs float during boot; the 100k pulldowns
    // do most of the work, but firmware also asserts LOW immediately to
    // close the window between reset and stable user code.
    pinMode(PIN_LED_GATE, OUTPUT);
    digitalWrite(PIN_LED_GATE, LOW);
    pinMode(PIN_SOLENOID_GATE, OUTPUT);
    digitalWrite(PIN_SOLENOID_GATE, LOW);
}

void setup() {
    hold_high_current_rails_low();

    Serial.begin(115200);
    delay(200);

    clap_log_begin();

    clap_log("");
    clap_log("=== Electronic Clapboard - Phase 2: frame sink ===");
    clap_log("Build:    %s %s", __DATE__, __TIME__);
#ifdef FIRMWARE_VERSION
    clap_log("Firmware: %s", FIRMWARE_VERSION);
#endif
    clap_log("Rails:    LED + solenoid held LOW");

    // Order matters: allocate the PSRAM buffer and bring the panel up
    // before any HTTP route can fire, so the first /frame request
    // arriving immediately after Wi-Fi associates can't race init.
    frame::begin();
    display::begin();

    net::begin();
    log_server::begin();

    // Boot splash: wait briefly for Wi-Fi association so the IP is
    // populated, then paint a "what was just flashed" screen with the
    // firmware version. The wait is best-effort — if Wi-Fi takes
    // longer than 8 s (wrong-password / AP down) we paint with
    // "0.0.0.0" so the firmware version is at least on-screen.
    net::wait_for_connection(8000);
    display::show_boot_screen(
#ifdef FIRMWARE_VERSION
        FIRMWARE_VERSION,
#else
        "?",
#endif
        net::current_ip(),
        net::current_hostname());
    clap_log("[boot] splash painted");
}

void loop() {
    net::service();
    log_server::service();
    frame::service();
    delay(50);
}
