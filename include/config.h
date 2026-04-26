#pragma once

// Electronic Clapboard — hardware configuration
// Pin assignments mirror CLAUDE.md and wiring-guide.md. Update together.

#include <Arduino.h>

// --- SPI — Waveshare 7.5" V2 e-paper ---
constexpr uint8_t PIN_EPD_MOSI = 11;
constexpr uint8_t PIN_EPD_CLK  = 12;
constexpr uint8_t PIN_EPD_CS   = 10;
constexpr uint8_t PIN_EPD_DC   = 9;
constexpr uint8_t PIN_EPD_RST  = 8;
constexpr uint8_t PIN_EPD_BUSY = 7;
constexpr uint8_t PIN_EPD_PWR  = 6;   // HAT rev2.3+ panel power enable

constexpr uint32_t EPD_PWR_SETTLE_MS = 10;

// --- MOSFET gate drives ---
constexpr uint8_t PIN_LED_GATE      = 4;
constexpr uint8_t PIN_SOLENOID_GATE = 5;

// --- Battery monitoring ---
constexpr uint8_t PIN_VBATT_ADC = 1;

// --- USB OTG (fallback wired keyboard) ---
constexpr uint8_t PIN_USB_DM = 19;
constexpr uint8_t PIN_USB_DP = 20;

// --- Sync timing ---
constexpr uint32_t LED_PULSE_MS           = 50;
constexpr uint32_t SOLENOID_PULSE_MS      = 60;
constexpr uint32_t SOLENOID_MAX_PULSE_MS  = 80;  // firmware safety cap

// --- Battery thresholds (3S LiPo, 11.1V nominal) ---
// Divider: 10k top / 3.3k bottom → ratio 3.3/(10+3.3) ≈ 0.2481
constexpr float    VBATT_DIVIDER_RATIO       = 3.3f / (10.0f + 3.3f);
constexpr uint32_t LOW_BATTERY_THRESHOLD_MV  = 10500;  // 3.50 V/cell — refuse sync below this
constexpr uint32_t CRITICAL_BATTERY_MV       = 9900;   // 3.30 V/cell — shut down
