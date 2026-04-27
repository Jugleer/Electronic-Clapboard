#include "display.h"

#include <Arduino.h>
#include <GxEPD2_BW.h>

#include "clap_log.h"
#include "config.h"

namespace {

// 7.5" V2, 800x480, B/W. Same panel as the typewriter env.
GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT>
    epd(GxEPD2_750_T7(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

void power_on() {
    pinMode(PIN_EPD_PWR, OUTPUT);
    digitalWrite(PIN_EPD_PWR, HIGH);
    delay(EPD_PWR_SETTLE_MS);
}

}  // namespace

namespace display {

void begin() {
    power_on();
    epd.init(115200);
    epd.setRotation(0);

    // Initial blank page so the panel is in a known state. Full refresh
    // clears whatever was on the screen at boot.
    epd.setFullWindow();
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);
    } while (epd.nextPage());

    clap_log("[display] init done; panel blanked");
}

uint32_t draw_partial_content(const uint8_t* buf) {
    // protocol.md §1: 1 = ink (black), 0 = paper (white), MSB-first,
    // scanlines top-to-bottom. GxEPD2::drawBitmap with GxEPD_BLACK
    // foreground gives "set bit = ink" directly (do NOT use
    // drawInvertedBitmap; see Phase 2 implementation note 11).
    const uint32_t t0 = millis();
    epd.setPartialWindow(0, 0, 800, 480);
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);
        epd.drawBitmap(0, 0, buf, 800, 480, GxEPD_BLACK);
    } while (epd.nextPage());
    return millis() - t0;
}

uint32_t draw_full_white() {
    const uint32_t t0 = millis();
    epd.setFullWindow();
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);
    } while (epd.nextPage());
    return millis() - t0;
}

void show_boot_screen(const char* firmware_version,
                      const char* ip_address,
                      const char* hostname) {
    epd.setFullWindow();
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);

        // Border.
        epd.drawRect(8, 8, 800 - 16, 480 - 16, GxEPD_BLACK);
        epd.drawRect(9, 9, 800 - 18, 480 - 18, GxEPD_BLACK);

        // Title.
        epd.setTextColor(GxEPD_BLACK);
        epd.setFont();  // built-in 5x7 (default size 1)
        epd.setTextSize(6);
        epd.setCursor(60, 60);
        epd.print("E-CLAPBOARD");

        // Subtitle.
        epd.setTextSize(2);
        epd.setCursor(60, 150);
        epd.print("Boot screen / firmware update");

        // Firmware version.
        epd.setTextSize(3);
        epd.setCursor(60, 210);
        epd.print("Firmware: ");
        epd.print(firmware_version ? firmware_version : "?");

        // Network info.
        epd.setTextSize(3);
        epd.setCursor(60, 270);
        epd.print("Host:     ");
        epd.print(hostname ? hostname : "?");

        epd.setCursor(60, 320);
        epd.print("IP:       ");
        epd.print(ip_address ? ip_address : "?");

        // Footer hint.
        epd.setTextSize(2);
        epd.setCursor(60, 410);
        epd.print("Send a frame from the editor to overwrite this screen.");
    } while (epd.nextPage());
}

}  // namespace display
