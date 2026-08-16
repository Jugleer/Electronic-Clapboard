#include <Arduino.h>

#include "can.h"
#include "clap_log.h"
#include "config.h"
#include "display.h"
#include "fire.h"
#include "framebuffer.h"
#include "slate.h"
#include "text_render.h"
#include "frame.h"
#include "log_server.h"
#include "net.h"
#include "power.h"
#include "screensaver.h"

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
    // because Phase 10's timer-wake path will short-circuit those entirely.
    power::begin();

    // Phase 10: timer-wake = screensaver tick. Skip Wi-Fi, log-server,
    // /frame route + boot splash entirely; just paint the next slate
    // and drop back into deep sleep. Total awake time per tick ~5 s,
    // dominated by the EPD full refresh.
    if (power::wake_reason() == power::WakeReason::Timer) {
        clap_log("[boot] timer-wake — screensaver tick path (no Wi-Fi)");
        screensaver::tick_and_resleep();  // [[noreturn]]
    }

    // Order matters: allocate the PSRAM buffer and bring the panel up
    // before any HTTP route can fire, so the first /frame request
    // arriving immediately after Wi-Fi associates can't race init.
    frame::begin();
    display::begin();

    // Phase 14: the slate compositor — a second 48 KB PSRAM buffer plus the
    // GFX font tables. Separate from frame::'s buffer on purpose: sharing
    // would save 48 KB of 8 MB while creating a race where a /frame POST
    // lands mid-composite. Non-fatal if it fails; the editor path and the
    // fire button stay useful without a compositor, which is why this does
    // not panic the way frame::begin() does.
    if (framebuffer::begin()) {
        text_render::begin();
        slate::begin();
    }

    // Phase 9: fire button + LED/solenoid pulse path. begin() must run
    // AFTER hold_high_current_rails_low() (the gates are already LOW)
    // and BEFORE net::begin() — the /status handler reads fire_ready /
    // last_fire_at_ms via fire::* accessors and would surface garbage
    // if it queried before init. Awake-only by construction: power::
    // service() runs first in loop() and may [[noreturn]]-call
    // enter_sleep() on long-press, so fire::service() never executes
    // during a sleep transition.
    fire::begin();

    // Phase 13: TWAI link to the Jugglebot CAN3 drop. Starts heartbeating
    // immediately and unconditionally — the bridge will not transmit to a
    // bus where it has not seen a partner frame within 5 s, so we have to
    // introduce ourselves first (protocol.md §8.1). Placed before
    // net::begin() so the heartbeat is already running while Wi-Fi
    // association blocks for up to 8 s in the boot-splash wait below.
    can_link::begin();

    // Phase 10: mount LittleFS, reconcile manifest, load NVS-persisted
    // config + counter. Must run BEFORE net::begin() so the routes the
    // screensaver registers can read the manifest immediately. The
    // cycle is paused-for-this-awake-session inside begin() so editor
    // writes don't race a timer-wake.
    screensaver::begin();

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
    // CAN RX runs on its own task (a 50 ms loop tick cannot keep up with a
    // 100 Hz time-sync broadcast). This only pumps the periodic heartbeat
    // and bus-off recovery, both of which tolerate the 50 ms granularity.
    can_link::service();
    // Runs a queued /slate composite. Must be here rather than in the HTTP
    // handler: the panel blocks for seconds and the handler runs on the
    // AsyncTCP task.
    slate::service();
    delay(50);
}
