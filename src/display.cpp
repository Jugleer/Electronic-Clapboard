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

uint32_t draw_frame(const uint8_t* buf, bool full_refresh) {
    const uint32_t t0 = millis();

    // protocol.md §1: 1 = ink (black), 0 = paper (white), MSB-first,
    // scanlines top-to-bottom. GxEPD2's drawBitmap takes the bit array and
    // draws the foreground colour where bits are SET — pairing it with
    // GxEPD_BLACK gives "1 = black" exactly. Do NOT use drawInvertedBitmap
    // here: tools/generate_slides.py inverts at pack time, so it pairs with
    // drawInvertedBitmap, but our wire format from tools/frame_format.py
    // (and web/src/frameFormat.ts) packs straight per protocol.md.
    if (full_refresh) {
        epd.setFullWindow();
    } else {
        epd.setPartialWindow(0, 0, 800, 480);
    }
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);
        epd.drawBitmap(0, 0, buf, 800, 480, GxEPD_BLACK);
    } while (epd.nextPage());

    return millis() - t0;
}

}  // namespace display
