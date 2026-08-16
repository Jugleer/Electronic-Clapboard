#include "fire.h"

#include <Arduino.h>
#include <esp_attr.h>
#include <soc/gpio_struct.h>

#include "can.h"
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
//   2. On Action::Fire, start_pulse() drives PIN_LED_GATE HIGH and arms
//      a one-shot hardware timer to fire LED_PULSE_MS later.
//   3. The hw_timer_t ISR (pulse_end_isr) clears both gates LOW via a
//      single GPIO register write — atomic and IRAM-safe.
//
// Phase 11 cut audio sync (see config.h PIN_SOLENOID_GATE). The solenoid
// gate is still cleared by the ISR and still forced LOW at boot, but
// nothing raises it. The state machine, the watchdog, and the gate-driver
// contract are all unchanged — this module drives one emitter instead of
// two, which is why fire_state.h needed no edit.
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

// Cached rail-too-low state. Always false while CLAPBOARD_HAS_RAIL_ADC is 0
// — the divider is unpopulated, so there is nothing to sample.
//
// This must NOT fall back to reading the pin anyway. GPIO 1 is left floating
// with the divider removed, and analogReadMilliVolts() on a floating pin
// returns drifting noise that can cross any threshold you pick. The failure
// mode would be a fire button that intermittently does nothing, which reads
// as a wiring fault and is miserable to diagnose.
bool g_low_battery = false;

// Static guard: the hardware timer alarm window is the only thing
// gating how long the gates stay HIGH, so it must respect the safety
// cap. Tighten this assertion if LED_PULSE_MS ever climbs.
static_assert(LED_PULSE_MS <= FIRE_MAX_PULSE_MS,
              "LED_PULSE_MS must not exceed FIRE_MAX_PULSE_MS");

#if CLAPBOARD_LED_HOLD_MODE
// Tracks whether the gate is currently held up by hold mode, so we only
// touch the GPIO and the backstop timer on edges rather than every tick.
bool     g_hold_active     = false;
uint32_t g_hold_started_ms = 0;
#endif

void IRAM_ATTR pulse_end_isr() {
    // Atomic: clear both gate bits in a single register store. Direct
    // register access is the standard ESP32 ISR-safe idiom for GPIO
    // — digitalWrite() may pull paths we don't want from interrupt
    // context. Both gates are < GPIO 32 so the low-bank w1tc register
    // covers them.
    GPIO.out_w1tc = (1u << PIN_LED_GATE) | (1u << PIN_SOLENOID_GATE);
}

uint32_t sample_pack_mv() {
#if CLAPBOARD_HAS_RAIL_ADC
    // analogReadMilliVolts() returns calibrated mV at the ADC pin. The
    // divider scales the rail down by VBATT_DIVIDER_RATIO; we multiply back
    // to recover rail mV. analogReadMilliVolts already averages internally
    // on Arduino-ESP32 v2.x, so a single call is sufficient.
    const uint32_t pin_mv = analogReadMilliVolts(PIN_VBATT_ADC);
    return (uint32_t) (pin_mv / VBATT_DIVIDER_RATIO);
#else
    // No divider fitted. Report 0 rather than a plausible-looking constant
    // so /status and CLAP_HEARTBEAT consumers can tell "not measured" from
    // "measured 12 V".
    return 0;
#endif
}

#if CLAPBOARD_LED_HOLD_MODE
// Bench mode: raise the gate and arm the long backstop. Called on the
// press edge only.
void hold_begin() {
    digitalWrite(PIN_LED_GATE, HIGH);
    timerWrite(g_pulse_timer, 0);
    timerAlarmWrite(g_pulse_timer,
                    (uint64_t) FIRE_HOLD_MAX_MS * 1000,
                    /*autoreload=*/false);
    timerAlarmEnable(g_pulse_timer);
}

// Called on the release edge. Disarm the backstop first, then drop the
// gate — the reverse order would leave a window where a backstop fire
// races our own write.
void hold_end() {
    timerAlarmDisable(g_pulse_timer);
    digitalWrite(PIN_LED_GATE, LOW);
}
#endif

// [[maybe_unused]]: hold mode drives the gate directly and never calls this.
// Kept compiled in both modes so flipping CLAPBOARD_LED_HOLD_MODE back to 0
// is a one-line change with nothing else to restore.
[[maybe_unused]] void start_pulse() {
    // Single emitter as of Phase 11. PIN_SOLENOID_GATE is deliberately
    // NOT raised — audio sync is a v2 feature (config.h documents why).
    // To re-add it, raise the solenoid gate on the line below this one:
    // the ISR already clears both gates, and the watchdog window already
    // covers both, so no other change is needed.
    digitalWrite(PIN_LED_GATE, HIGH);

    // Re-arm the one-shot. Reset the count to 0 and set the alarm
    // value in microseconds (timer tick = 1 µs given the divider in
    // begin()). autoreload=false → the alarm fires once and stays
    // disabled until we re-enable it for the next pulse.
    timerWrite(g_pulse_timer, 0);
    timerAlarmWrite(g_pulse_timer,
                    (uint64_t) LED_PULSE_MS * 1000,
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
    // PIN_SOLENOID_GATE is claimed and forced LOW even though nothing
    // raises it (Phase 11). An unclaimed pin floats; a floating gate on a
    // populated MOSFET can latch the load on. Claiming it is the cheaper
    // half of "MOSFET gate outputs must default LOW on boot".
    pinMode(PIN_LED_GATE,      OUTPUT);
    pinMode(PIN_SOLENOID_GATE, OUTPUT);
    digitalWrite(PIN_LED_GATE,      LOW);
    digitalWrite(PIN_SOLENOID_GATE, LOW);

#if CLAPBOARD_HAS_RAIL_ADC
    // ADC config for the rail divider. 12-bit width at 11 dB attenuation.
    analogReadResolution(12);
    analogSetPinAttenuation(PIN_VBATT_ADC, ADC_11db);
#endif

    // Hardware timer #0 is unclaimed elsewhere in this firmware. APB
    // clock is 80 MHz; divider 80 → 1 MHz tick (1 µs/tick). Edge-
    // triggered ISR: the alarm fires once on the rising edge of the
    // count-vs-alarm comparison.
    g_pulse_timer = timerBegin(/*timer=*/0, /*divider=*/80, /*countUp=*/true);
    timerAttachInterrupt(g_pulse_timer, &pulse_end_isr, /*edge=*/true);

    g_sm.reset();
    g_low_battery = false;

#if CLAPBOARD_LED_HOLD_MODE
    g_hold_active = false;
    clap_log("[fire] armed in HOLD MODE (bench) — LED follows PIN_FIRE_BUTTON=%u, "
             "backstop %lu ms. Set CLAPBOARD_LED_HOLD_MODE=0 for the %lu ms flash.",
             (unsigned) PIN_FIRE_BUTTON,
             (unsigned long) FIRE_HOLD_MAX_MS,
             (unsigned long) LED_PULSE_MS);
#else
    clap_log("[fire] armed; PIN_FIRE_BUTTON=%u min_gap=%lu ms pulse=%lu (cap %lu) ms",
             (unsigned) PIN_FIRE_BUTTON,
             (unsigned long) MIN_FIRE_GAP_MS,
             (unsigned long) LED_PULSE_MS,
             (unsigned long) FIRE_MAX_PULSE_MS);
#endif
}

void service() {
    const uint32_t now = millis();

    // Refresh the rail-low flag every tick. Cheap (~10 µs); the alternative
    // of "sample only on press" risks accepting a press and then realising
    // mid-pulse that the supply is gasping. Returns 0 with no divider
    // fitted, in which case there is nothing to gate on.
    const uint32_t rail_mv = sample_pack_mv();
#if CLAPBOARD_HAS_RAIL_ADC
    g_low_battery = (rail_mv < RAIL_MIN_FIRE_MV);
#else
    g_low_battery = false;
#endif

    // Debounce the raw button level via the same ButtonTracker the
    // wake path uses. We only consume the debounced level here; the
    // long-press detector inside ButtonTracker is irrelevant for fire
    // and harmlessly idle.
    const bool raw_pressed = (digitalRead(PIN_FIRE_BUTTON) == LOW);
    g_button.sample(now, raw_pressed);
    const bool debounced = g_button.debounced_pressed();

#if CLAPBOARD_LED_HOLD_MODE
    // Bench mode: the gate simply follows the debounced button level. The
    // fire_state machine is bypassed entirely — its whole job is pulse and
    // cooldown semantics, neither of which applies to a hold switch, and
    // running it here would refuse the second press of every pair.
    //
    // We still tick the state machine so fires_since_boot / last_fire_at_ms
    // stay meaningful for /status, but we ignore its Action and drive the
    // gate ourselves. Passing a 0 min_gap keeps it out of CoolDown so each
    // press counts.
    (void) g_sm.sample(now, debounced, /*low_battery=*/false,
                       /*pulse_ms=*/0, /*min_gap_ms=*/0);

    if (debounced && !g_hold_active) {
        g_hold_active     = true;
        g_hold_started_ms = now;
        hold_begin();
        clap_log("[fire] HOLD on at %lu ms (n=%lu)",
                 (unsigned long) now,
                 (unsigned long) g_sm.fires_since_boot());
    } else if (!debounced && g_hold_active) {
        g_hold_active = false;
        hold_end();
        clap_log("[fire] HOLD off at %lu ms (held %lu ms)",
                 (unsigned long) now,
                 (unsigned long) (now - g_hold_started_ms));
    } else if (g_hold_active && (now - g_hold_started_ms) >= FIRE_HOLD_MAX_MS) {
        // The ISR has already forced the gate LOW by now — this branch only
        // mirrors that in software so we latch off and say so. We track the
        // deadline rather than reading the pin back, because pinMode(OUTPUT)
        // on the ESP32 disables the input buffer and digitalRead() on an
        // output pin does not reliably reflect the pad level.
        g_hold_active = false;
        clap_log("[fire] HOLD backstop fired after %lu ms — gate forced LOW. "
                 "Release and re-press to re-arm.",
                 (unsigned long) FIRE_HOLD_MAX_MS);
    }
#else
    const fire_state::Action action = g_sm.sample(
        now, debounced, g_low_battery,
        LED_PULSE_MS, MIN_FIRE_GAP_MS);
    if (action == fire_state::Action::Fire) {
        clap_log("[fire] FIRE at %lu ms (n=%lu rail=%lu mV)",
                 (unsigned long) now,
                 (unsigned long) g_sm.fires_since_boot(),
                 (unsigned long) rail_mv);
        start_pulse();
        // Report AFTER raising the gate. The flash instant is what the sync
        // record refers to, and CAN transmission can block up to
        // TX_TIMEOUT_MS — doing it first would put that latency between the
        // timestamp and the light, which is the one error this record
        // exists to avoid.
        can_link::report_fire(g_sm.fires_since_boot());
    }
#endif
    (void) rail_mv;
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
