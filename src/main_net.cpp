#include <Arduino.h>

#include "clap_log.h"
#include "config.h"
#include "log_server.h"
#include "net.h"

// Phase 1 firmware entry point. Joins Wi-Fi, starts mDNS, serves /status
// over HTTP and a live log tail over TCP/23. No panel interaction — the
// EPD lives in the parallel `esp32s3` env that keeps building the
// typewriter demo as the SPI regression canary until Phase 4 of the
// firmware refactor.

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
    clap_log("=== Electronic Clapboard - Phase 1: net ===");
    clap_log("Build:    %s %s", __DATE__, __TIME__);
#ifdef FIRMWARE_VERSION
    clap_log("Firmware: %s", FIRMWARE_VERSION);
#endif
    clap_log("Rails:    LED + solenoid held LOW");

    net::begin();
    log_server::begin();
}

void loop() {
    net::service();
    log_server::service();
    delay(50);
}
