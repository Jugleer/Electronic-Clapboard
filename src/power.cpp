#include "power.h"

#include <Arduino.h>
#include <driver/rtc_io.h>
#include <esp_sleep.h>
#include <esp_system.h>

#include "clap_log.h"
#include "config.h"
#include "display.h"
#include "power_state.h"

namespace {

power::WakeReason         g_wake_reason = power::WakeReason::ColdBoot;
power_state::ButtonTracker g_button;

const char* reset_reason_name(esp_reset_reason_t r) {
    switch (r) {
        case ESP_RST_POWERON:   return "POWERON";
        case ESP_RST_EXT:       return "EXT";
        case ESP_RST_SW:        return "SW";
        case ESP_RST_PANIC:     return "PANIC";
        case ESP_RST_INT_WDT:   return "INT_WDT";
        case ESP_RST_TASK_WDT:  return "TASK_WDT";
        case ESP_RST_WDT:       return "WDT";
        case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
        case ESP_RST_BROWNOUT:  return "BROWNOUT";
        case ESP_RST_SDIO:      return "SDIO";
        default:                return "UNKNOWN";
    }
}

const char* wake_cause_name(esp_sleep_wakeup_cause_t c) {
    switch (c) {
        case ESP_SLEEP_WAKEUP_UNDEFINED: return "UNDEFINED";
        case ESP_SLEEP_WAKEUP_EXT0:      return "EXT0";
        case ESP_SLEEP_WAKEUP_EXT1:      return "EXT1";
        case ESP_SLEEP_WAKEUP_TIMER:     return "TIMER";
        case ESP_SLEEP_WAKEUP_GPIO:      return "GPIO";
        case ESP_SLEEP_WAKEUP_UART:      return "UART";
        case ESP_SLEEP_WAKEUP_TOUCHPAD:  return "TOUCHPAD";
        case ESP_SLEEP_WAKEUP_ULP:       return "ULP";
        default:                         return "OTHER";
    }
}

power::WakeReason classify_wake() {
    const auto reset_cause = esp_reset_reason();
    const auto sleep_cause = esp_sleep_get_wakeup_cause();
    // Log both so we can distinguish "clean ext0 wake" from "WDT reboot
    // during sleep entry" from "brownout" — which we need to diagnose
    // why deep-sleep isn't sticking on this board.
    clap_log("[power] reset_reason=%s sleep_cause=%s",
             reset_reason_name(reset_cause),
             wake_cause_name(sleep_cause));

    switch (sleep_cause) {
        case ESP_SLEEP_WAKEUP_EXT0:  return power::WakeReason::Button;
        case ESP_SLEEP_WAKEUP_TIMER: return power::WakeReason::Timer;
        default:                     return power::WakeReason::ColdBoot;
    }
}

}  // namespace

namespace power {

void begin() {
    g_wake_reason = classify_wake();

    // Wake button: input with internal pull-up. Idle = HIGH; pressed = LOW.
    // INPUT_PULLUP is a no-op for the deep-sleep ext0 wake itself (the RTC
    // domain handles that), but matters once we're awake and polling.
    pinMode(PIN_WAKE_BUTTON, INPUT_PULLUP);

    // Status LED: HIGH while awake. We were just woken (or just booted) so
    // light it immediately — gives the user instant visual feedback that
    // the press registered.
    pinMode(PIN_WAKE_LED, OUTPUT);
    digitalWrite(PIN_WAKE_LED, HIGH);

    clap_log("[power] awake; wake reason: %s", wake_reason_name());
}

WakeReason wake_reason() { return g_wake_reason; }

const char* wake_reason_name() {
    switch (g_wake_reason) {
        case WakeReason::Button:   return "button";
        case WakeReason::Timer:    return "timer";
        case WakeReason::ColdBoot: return "cold-boot";
    }
    return "?";
}

void service() {
    // Pull-up wiring: LOW means the user is pressing the button.
    const bool raw_pressed = (digitalRead(PIN_WAKE_BUTTON) == LOW);
    const auto event = g_button.sample(millis(), raw_pressed);
    if (event == power_state::ButtonTracker::Event::LongPress) {
        clap_log("[power] long-press detected; entering deep sleep");
        enter_sleep();  // [[noreturn]]
    }
}

void enter_sleep() {
    // Visual: blink LED 3× before sleep so the user sees the press
    // registered and the device is shutting down rather than crashed.
    for (int i = 0; i < 3; i++) {
        digitalWrite(PIN_WAKE_LED, LOW);
        delay(80);
        digitalWrite(PIN_WAKE_LED, HIGH);
        delay(80);
    }
    digitalWrite(PIN_WAKE_LED, LOW);

    // CLAUDE.md non-negotiable: MOSFET gates LOW before any state change
    // that could leave them floating. Re-assert defensively even though
    // setup() did this at boot — a bug elsewhere shouldn't be able to
    // strand the load rails on across a sleep cycle.
    pinMode(PIN_LED_GATE, OUTPUT);
    digitalWrite(PIN_LED_GATE, LOW);
    pinMode(PIN_SOLENOID_GATE, OUTPUT);
    digitalWrite(PIN_SOLENOID_GATE, LOW);

    // Drop the EPD logic rail. The bistable display retains its image
    // (whatever the user last sent, or the boot splash). On wake,
    // display::begin() re-powers and re-inits the panel.
    display::power_off();

    // Wait for the user to release the button before arming ext0.
    // Without this, a still-held button causes immediate wake (ext0
    // triggers on level LOW; if the line is already LOW when sleep
    // starts, the wake fires instantly — looks like "sleep didn't
    // happen"). 2 s timeout so a stuck button doesn't strand the
    // device awake forever; we'll sleep anyway and let it cycle.
    const uint32_t release_deadline = millis() + 2000;
    while (digitalRead(PIN_WAKE_BUTTON) == LOW && millis() < release_deadline) {
        delay(10);
    }
    if (digitalRead(PIN_WAKE_BUTTON) == LOW) {
        clap_log("[power] WARN: button still held after 2 s; arming sleep anyway");
    }

    clap_log("[power] sleeping; wake on PIN_WAKE_BUTTON LOW (GPIO %u)",
             (unsigned) PIN_WAKE_BUTTON);
    Serial.flush();
    delay(50);  // give USB-CDC log buffer a tick to drain

    const gpio_num_t wake_pin = static_cast<gpio_num_t>(PIN_WAKE_BUTTON);

    // Defensive: clear any wake source that might already be set (a
    // failed prior sleep attempt could leave one armed) before adding
    // ours. esp_sleep_enable_ext0_wakeup also switches the pin from
    // digital-IO mode to RTC-IO mode, which is what makes the
    // subsequent rtc_gpio_pullup_en call effective — that's the order
    // that bit us first time around.
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
    esp_sleep_enable_ext0_wakeup(wake_pin, 0);

    // RTC-domain pull-up. The digital INPUT_PULLUP set in begin() is
    // dropped when the digital IO domain powers down for deep-sleep;
    // without an RTC-domain pull-up the line floats and ext0 fires
    // immediately on the first noise pulse.
    rtc_gpio_pullup_en(wake_pin);
    rtc_gpio_pulldown_dis(wake_pin);

    esp_deep_sleep_start();
    // esp_deep_sleep_start() never returns; the chip resets on wake and
    // re-enters setup() with esp_sleep_get_wakeup_cause() == EXT0. If
    // we somehow fall through (USB-CDC interference, peripheral state,
    // etc.), reset the chip rather than spin — a clean cold boot beats
    // a wedged loop the user can't recover from without power-cycling.
    clap_log("[power] FATAL: esp_deep_sleep_start returned; restarting");
    Serial.flush();
    delay(100);
    esp_restart();
}

}  // namespace power
