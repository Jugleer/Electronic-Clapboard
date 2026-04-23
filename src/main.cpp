#include <Arduino.h>
#include "config.h"

static void safe_pin_init() {
    // Loads off FIRST, before anything else. If this function ever changes,
    // verify boot-time gate voltage with a scope — MOSFETs must see 0V at power-up.
    pinMode(PIN_LED_GATE, OUTPUT);
    digitalWrite(PIN_LED_GATE, LOW);
    pinMode(PIN_SOLENOID_GATE, OUTPUT);
    digitalWrite(PIN_SOLENOID_GATE, LOW);
}

void setup() {
    safe_pin_init();

    Serial.begin(115200);
    // Native USB CDC needs a moment before the first println is captured.
    delay(200);

    Serial.println();
    Serial.println("=== Electronic Clapboard ===");
    Serial.printf("Build: %s %s\n", __DATE__, __TIME__);
    Serial.printf("PSRAM size: %u bytes\n", (unsigned) ESP.getPsramSize());
    Serial.printf("Free heap:  %u bytes\n", (unsigned) ESP.getFreeHeap());
    Serial.println("Boot OK. Awaiting state machine wiring.");
}

void loop() {
    // Heartbeat so we can confirm the board is alive over serial.
    static uint32_t last = 0;
    const uint32_t now = millis();
    if (now - last >= 2000) {
        last = now;
        Serial.printf("[%lu ms] heartbeat\n", (unsigned long) now);
    }
}
