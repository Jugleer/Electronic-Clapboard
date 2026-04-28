#include <Arduino.h>

#include "clap_log.h"
#include "config.h"
#include "display.h"
#include "fire.h"
#include "frame.h"
#include "log_server.h"
#include "net.h"
#include "power.h"

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

    // Phase 8: classify wake reason and turn the status LED on. Must run
    // before any other Arduino-side init that touches the panel or radio,
    // because Phase 9's timer-wake path will short-circuit those entirely.
    power::begin();

    // Order matters: allocate the PSRAM buffer and bring the panel up
    // before any HTTP route can fire, so the first /frame request
    // arriving immediately after Wi-Fi associates can't race init.
    frame::begin();
    display::begin();

    // Phase 9: fire button + LED/solenoid pulse path. begin() must run
    // AFTER hold_high_current_rails_low() (the gates are already LOW)
    // and BEFORE net::begin() — the /status handler reads fire_ready /
    // last_fire_at_ms via fire::* accessors and would surface garbage
    // if it queried before init. Awake-only by construction: power::
    // service() runs first in loop() and may [[noreturn]]-call
    // enter_sleep() on long-press, so fire::service() never executes
    // during a sleep transition.
    fire::begin();

    net::begin();
    log_server::begin();

    // Boot splash: wait briefly for Wi-Fi association so the IP is
    // populated, then paint a "what was just flashed" screen with the
    // firmware version. The wait is best-effort — if Wi-Fi takes
    // longer than 8 s (wrong-password / AP down) we paint with
    // "0.0.0.0" so the firmware version is at least on-screen.
    //
    // On a Phase-9 timer-wake (not yet implemented) we'd skip this
    // entirely and go straight to the screensaver tick. For Phase 8,
    // timer wake never fires, so the branch is informational.
    if (power::wake_reason() != power::WakeReason::Timer) {
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
}

void loop() {
    net::service();
    log_server::service();
    frame::service();
    // power::service() may [[noreturn]]-call enter_sleep() on a long-
    // press; placing fire::service() AFTER it means a sleep transition
    // never proceeds to fire-button polling. Practical effect: presses
    // landing in the sleep window are simply not sampled — the fire
    // path is awake-only by virtue of loop() not running while asleep.
    power::service();
    fire::service();
    delay(50);
}
