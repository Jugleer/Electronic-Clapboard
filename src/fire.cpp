#include "fire.h"

#include <Arduino.h>
#include <esp_attr.h>
#include <soc/gpio_struct.h>

#include "clap_log.h"
#include "config.h"
#include "fire_state.h"
#include "power_state.h"

// Phase 9 fire path. Module overview lives in fire.h; this file is the
// Arduino-side glue + the hw_timer_t safety ISR.
//
// Pulse sequence:
//   1. service() debounces the button via the same ButtonTracker the
//      wake path uses, samples VBATT_ADC, and feeds both into the
//      pure fire_state state machine.
//   2. On Action::Fire, start_pulse() drives PIN_LED_GATE +
//      PIN_SOLENOID_GATE HIGH simultaneously and arms a one-shot
//      hardware timer to fire SOLENOID_PULSE_MS later.
//   3. The hw_timer_t ISR (pulse_end_isr) clears both gates LOW via a
//      single GPIO register write — atomic and IRAM-safe.
//
// CLAUDE.md non-negotiables this satisfies:
//   - "Solenoid pulse must have a firmware-enforced maximum duration.
//     A watchdog or timer callback must force the pin LOW even if main
//     code hangs."
//     The hardware-timer ISR runs from interrupt context — independent
//     of FreeRTOS scheduling, AsyncTCP work-queue depth, or display
//     SPI activity. A wedged loop() cannot prevent it.
//   - "Battery voltage must be checked before every sync event."
//     g_low_battery is refreshed every service() tick from
//     analogReadMilliVolts(PIN_VBATT_ADC); the state machine's
//     low_battery argument carries it in.
//   - "MOSFET gate outputs must default LOW on boot."
//     hold_high_current_rails_low() in main_net.cpp does this before
//     fire::begin() runs.

namespace {

power_state::ButtonTracker g_button;
fire_state::StateMachine   g_sm;
hw_timer_t*                g_pulse_timer = nullptr;

// Cached low-battery state. v1: single-sample threshold, no smoothing.
// LOW_BATTERY_THRESHOLD_MV (10500) sits 600 mV above CRITICAL_BATTERY_MV
// (9900), which is wider than typical ADC noise on the divider — flapping
// refusals around the threshold are not a realistic concern.
bool g_low_battery = false;

// Static guard: the hardware timer alarm window is the only thing
// gating how long the gates stay HIGH, so it must respect the safety
// cap. Tighten this assertion if SOLENOID_PULSE_MS ever climbs.
static_assert(SOLENOID_PULSE_MS <= SOLENOID_MAX_PULSE_MS,
              "SOLENOID_PULSE_MS must not exceed SOLENOID_MAX_PULSE_MS");

void IRAM_ATTR pulse_end_isr() {
    // Atomic: clear both gate bits in a single register store. Direct
    // register access is the standard ESP32 ISR-safe idiom for GPIO
    // — digitalWrite() may pull paths we don't want from interrupt
    // context. Both gates are < GPIO 32 so the low-bank w1tc register
    // covers them.
    GPIO.out_w1tc = (1u << PIN_LED_GATE) | (1u << PIN_SOLENOID_GATE);
}

uint32_t sample_pack_mv() {
    // analogReadMilliVolts() returns calibrated mV at the ADC pin. The
    // 10k/3.3k divider scales pack_v down by VBATT_DIVIDER_RATIO; we
    // multiply back to recover pack mV. analogReadMilliVolts already
    // averages internally on Arduino-ESP32 v2.x, so a single call is
    // sufficient for the threshold check.
    const uint32_t pin_mv = analogReadMilliVolts(PIN_VBATT_ADC);
    return (uint32_t) (pin_mv / VBATT_DIVIDER_RATIO);
}

void start_pulse() {
    // CLAUDE.md: simultaneous rise. Both writes on adjacent lines, no
    // intervening work — the GPIO peripheral retires them within the
    // same APB cycle on the ESP32-S3.
    digitalWrite(PIN_LED_GATE,      HIGH);
    digitalWrite(PIN_SOLENOID_GATE, HIGH);

    // Re-arm the one-shot. Reset the count to 0 and set the alarm
    // value in microseconds (timer tick = 1 µs given the divider in
    // begin()). autoreload=false → the alarm fires once and stays
    // disabled until we re-enable it for the next pulse.
    timerWrite(g_pulse_timer, 0);
    timerAlarmWrite(g_pulse_timer,
                    (uint64_t) SOLENOID_PULSE_MS * 1000,
                    /*autoreload=*/false);
    timerAlarmEnable(g_pulse_timer);
}

}  // namespace

namespace fire {

void begin() {
    // The fire button mirrors the wake button's wiring idiom: button
    // to GND with internal pull-up, pressed = LOW.
    pinMode(PIN_FIRE_BUTTON, INPUT_PULLUP);

    // Defensive re-assert: hold_high_current_rails_low() in setup()
    // already drove these LOW before any other init ran. Repeating
    // here means a future caller of fire::begin() (e.g. a hot-reload
    // path) doesn't have to know about the boot-time invariant.
    pinMode(PIN_LED_GATE,      OUTPUT);
    pinMode(PIN_SOLENOID_GATE, OUTPUT);
    digitalWrite(PIN_LED_GATE,      LOW);
    digitalWrite(PIN_SOLENOID_GATE, LOW);

    // ADC config for VBATT. 12-bit width across 0–~3.1 V at the pin
    // (11 dB attenuation) — covers the full 0–4.2 V/cell × 3 cells
    // post-divider range with comfortable headroom.
    analogReadResolution(12);
    analogSetPinAttenuation(PIN_VBATT_ADC, ADC_11db);

    // Hardware timer #0 is unclaimed elsewhere in this firmware. APB
    // clock is 80 MHz; divider 80 → 1 MHz tick (1 µs/tick). Edge-
    // triggered ISR: the alarm fires once on the rising edge of the
    // count-vs-alarm comparison.
    g_pulse_timer = timerBegin(/*timer=*/0, /*divider=*/80, /*countUp=*/true);
    timerAttachInterrupt(g_pulse_timer, &pulse_end_isr, /*edge=*/true);

    g_sm.reset();
    g_low_battery = false;

    clap_log("[fire] armed; PIN_FIRE_BUTTON=%u min_gap=%lu ms pulse=%lu (cap %lu) ms",
             (unsigned) PIN_FIRE_BUTTON,
             (unsigned long) MIN_FIRE_GAP_MS,
             (unsigned long) SOLENOID_PULSE_MS,
             (unsigned long) SOLENOID_MAX_PULSE_MS);
}

void service() {
    const uint32_t now = millis();

    // Refresh the low-battery flag every tick. Cheap (~10 µs); the
    // alternative of "sample only on press" risks accepting a press
    // and then realising mid-pulse that the pack is gasping. Catching
    // it before the press is a better UX (silent refusal) and matches
    // the CLAUDE.md "check battery before every sync event" intent.
    const uint32_t pack_mv = sample_pack_mv();
    g_low_battery = (pack_mv < LOW_BATTERY_THRESHOLD_MV);

    // Debounce the raw button level via the same ButtonTracker the
    // wake path uses. We only consume the debounced level here; the
    // long-press detector inside ButtonTracker is irrelevant for fire
    // and harmlessly idle.
    const bool raw_pressed = (digitalRead(PIN_FIRE_BUTTON) == LOW);
    g_button.sample(now, raw_pressed);
    const bool debounced = g_button.debounced_pressed();

    const fire_state::Action action = g_sm.sample(
        now, debounced, g_low_battery,
        SOLENOID_PULSE_MS, MIN_FIRE_GAP_MS);
    if (action == fire_state::Action::Fire) {
        clap_log("[fire] FIRE at %lu ms (n=%lu pack=%lu mV)",
                 (unsigned long) now,
                 (unsigned long) g_sm.fires_since_boot(),
                 (unsigned long) pack_mv);
        start_pulse();
    }
}

std::optional<uint32_t> last_fire_at_ms() {
    if (!g_sm.has_fired()) return std::nullopt;
    return g_sm.last_fire_at_ms();
}

uint32_t fires_since_boot() {
    return g_sm.fires_since_boot();
}

bool is_fire_ready() {
    return g_sm.is_fire_ready(g_low_battery);
}

}  // namespace fire
