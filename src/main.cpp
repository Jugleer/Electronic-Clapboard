#include <Arduino.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeMono12pt7b.h>
#include "config.h"

// Phase 3 typewriter mode: stream a story to the panel one char at a time
// using partial refresh. LED + solenoid are held LOW the whole time.
//
// Note on rate: the 7.5" V2 panel's partial refresh has a worst-case latency
// of ~1.6 s (per the GxEPD2 driver). We TARGET 500 ms / char (2 Hz) but if
// the panel takes longer, the next char simply waits. The natural cadence
// you see is set by the panel, not the firmware.

constexpr uint32_t TARGET_CHAR_INTERVAL_MS = 500;  // 2 Hz aspirational
constexpr uint32_t PAGE_HOLD_AFTER_FULL_MS = 1500; // pause after page wipe
constexpr uint32_t INITIAL_HOLD_MS         = 1200; // brief hold on blank page

// --- Layout (landscape 800x480) ---
// FreeMono12pt7b is monospaced — every glyph is the same advance width.
// Empirically: ~14 px wide, ~24 px tall (max ascent+descent).
constexpr int16_t MARGIN_X        = 30;
constexpr int16_t MARGIN_TOP      = 50;
constexpr int16_t MARGIN_BOTTOM   = 30;
constexpr int16_t LINE_HEIGHT     = 28;
constexpr int16_t CHAR_ADVANCE    = 14;
constexpr int16_t TEXT_AREA_W     = 800 - 2 * MARGIN_X;
constexpr int16_t TEXT_AREA_H     = 480 - MARGIN_TOP - MARGIN_BOTTOM;
constexpr int16_t CHARS_PER_LINE  = TEXT_AREA_W / CHAR_ADVANCE;        // ~52
constexpr int16_t LINES_PER_PAGE  = TEXT_AREA_H / LINE_HEIGHT;         // ~14
// Safety bound for the per-line buffer (avoid VLA, give some headroom).
constexpr size_t  LINE_BUF_MAX    = 80;

// --- Story text (PROGMEM) ---
// Original short noir-on-set piece. Newlines are paragraph breaks.
const char STORY[] PROGMEM =
"It was a Tuesday on the lot, and Tuesdays on the lot were always the worst.\n"
"\n"
"The director had not slept. You could tell by the way he held his coffee, "
"like a man who suspected the cup of personal betrayal. The DP was somewhere "
"behind a flag, muttering at the sun. Continuity was on her third clipboard. "
"The first two had walked off, possibly with a runner.\n"
"\n"
"Marlowe stepped onto the mark. Marlowe was not the character's name. The "
"character's name was Stephen, and Stephen was an accountant. But Marlowe "
"was what the crew had taken to calling him, on account of the trench coat "
"he refused to take off, even between setups, even at lunch.\n"
"\n"
"The slate came up. Scene 14, take 7.\n"
"\n"
"The clap was sharp. Sharp enough to cut Tuesday in half.\n"
"\n"
"And then, from somewhere off-camera, a quiet click.\n"
"\n"
"\"Cut,\" said the director, who had not yet said action.\n"
"\n"
"Everyone looked at him. He looked at the slate. The slate, somehow, was "
"already on the next take.\n"
"\n"
"\"Roll it back,\" he said.\n"
"\n"
"The script supervisor opened her notebook. There was no scene 14. There had "
"never been a scene 14. There had been a scene 13, and after that they had "
"intended to break for lunch, and after lunch they had intended to do scene "
"15, in which Stephen confronts his ex-wife at a bowling alley.\n"
"\n"
"Marlowe took off the trench coat and sat down on a flight case.\n"
"\n"
"\"I think,\" he said carefully, \"I might know what's going on.\"\n"
"\n"
"He did not. But it felt good to say.\n"
"\n"
"Outside, the parking lot, the day kept going. Somewhere a truck reversed. "
"Somewhere else, a pigeon settled on a boom mic and considered its options.\n"
"\n"
"On set, the slate clapped again. No one had touched it.\n"
"\n"
"-- end of reel --\n";

GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT>
    epd(GxEPD2_750_T7(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

static void hold_high_current_rails_low() {
    pinMode(PIN_LED_GATE, OUTPUT);
    digitalWrite(PIN_LED_GATE, LOW);
    pinMode(PIN_SOLENOID_GATE, OUTPUT);
    digitalWrite(PIN_SOLENOID_GATE, LOW);
}

static void epd_power_on() {
    digitalWrite(PIN_EPD_PWR, HIGH);
    delay(EPD_PWR_SETTLE_MS);
}

// State for incremental drawing.
static int16_t cursor_x = MARGIN_X;
static int16_t cursor_y = MARGIN_TOP;

// --- Page wipe via full refresh (clears ghosting too) ---
static void page_clear_full() {
    epd.setFullWindow();
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);
    } while (epd.nextPage());
    cursor_x = MARGIN_X;
    cursor_y = MARGIN_TOP;
}

// --- Draw a single character via partial refresh of just its cell ---
static uint32_t draw_char_partial(char c) {
    // Bounding box for the new glyph cell. We pad +/- a couple of px so
    // descenders / antialias edges aren't clipped.
    const int16_t cell_x = cursor_x;
    const int16_t cell_y = cursor_y - LINE_HEIGHT + 4;  // top of the cell
    const int16_t cell_w = CHAR_ADVANCE + 2;
    const int16_t cell_h = LINE_HEIGHT;

    const uint32_t t0 = millis();
    epd.setPartialWindow(cell_x, cell_y, cell_w, cell_h);
    epd.firstPage();
    do {
        epd.fillScreen(GxEPD_WHITE);
        epd.setCursor(cursor_x, cursor_y);
        epd.print(c);
    } while (epd.nextPage());
    return millis() - t0;
}

// Advance cursor to next line; returns true if we wrapped off the page.
static bool advance_line() {
    cursor_x = MARGIN_X;
    cursor_y += LINE_HEIGHT;
    return cursor_y > (480 - MARGIN_BOTTOM);
}

// --- Wrap-aware feeder ---
//
// We type the next char each call. To avoid splitting words across lines,
// we look ahead at the upcoming word: if it won't fit in what's left of
// the current line, we soft-wrap before typing the leading space.
//
// Returns how long the partial refresh took (or 0 if no draw happened).
static uint32_t type_next_char(size_t& idx) {
    if (idx >= sizeof(STORY) - 1) return 0;

    char c = pgm_read_byte(&STORY[idx]);

    // Hard newline in source -> end the current line, then a blank gap line.
    if (c == '\n') {
        idx++;
        if (advance_line()) {
            page_clear_full();
            delay(PAGE_HOLD_AFTER_FULL_MS);
        }
        return 0;
    }

    // Word-wrap: at a space, peek ahead to see how long the next word is.
    if (c == ' ') {
        size_t peek = idx + 1;
        int word_len = 0;
        while (peek < sizeof(STORY) - 1) {
            char p = pgm_read_byte(&STORY[peek]);
            if (p == ' ' || p == '\n' || p == '\0') break;
            word_len++;
            peek++;
        }
        // chars used so far on this line:
        const int16_t chars_used = (cursor_x - MARGIN_X) / CHAR_ADVANCE;
        if (chars_used + 1 + word_len > CHARS_PER_LINE) {
            // Soft-wrap: skip the space, advance line.
            idx++;
            if (advance_line()) {
                page_clear_full();
                delay(PAGE_HOLD_AFTER_FULL_MS);
            }
            return 0;
        }
    }

    // Hard wrap (word longer than the line — rare, but handle it).
    const int16_t chars_used = (cursor_x - MARGIN_X) / CHAR_ADVANCE;
    if (chars_used >= CHARS_PER_LINE) {
        if (advance_line()) {
            page_clear_full();
            delay(PAGE_HOLD_AFTER_FULL_MS);
        }
    }

    // Draw and advance.
    const uint32_t refresh_ms = draw_char_partial(c);
    cursor_x += CHAR_ADVANCE;
    idx++;
    return refresh_ms;
}

void setup() {
    hold_high_current_rails_low();

    pinMode(PIN_EPD_PWR, OUTPUT);
    digitalWrite(PIN_EPD_PWR, LOW);

    Serial.begin(115200);
    delay(200);

    Serial.println();
    Serial.println("=== Electronic Clapboard — Phase 3: typewriter ===");
    Serial.printf("Build: %s %s\n", __DATE__, __TIME__);
    Serial.println("LED + solenoid: held LOW (high-current rails disabled)");
    Serial.printf("Story: %u chars  layout: %dx%d (chars per line x lines per page)\n",
                  (unsigned) (sizeof(STORY) - 1),
                  CHARS_PER_LINE, LINES_PER_PAGE);

    epd_power_on();
    epd.init(115200);
    epd.setRotation(0);
    epd.setFont(&FreeMono12pt7b);
    epd.setTextColor(GxEPD_BLACK);

    // Initial blank page (full refresh — clears whatever was there).
    page_clear_full();
    Serial.println("Display initialised, page blanked.");
    delay(INITIAL_HOLD_MS);
}

void loop() {
    static size_t idx = 0;
    static uint32_t char_count = 0;

    if (idx >= sizeof(STORY) - 1) {
        // Story done — hold final page, then full-refresh + restart.
        Serial.println("Story complete. Holding final page for 10 s, then restarting.");
        delay(10000);
        page_clear_full();
        delay(PAGE_HOLD_AFTER_FULL_MS);
        idx = 0;
        char_count = 0;
        return;
    }

    const uint32_t loop_start = millis();
    const uint32_t refresh_ms = type_next_char(idx);

    if (refresh_ms > 0) {
        char_count++;
        if (char_count % 8 == 0) {
            Serial.printf("[%lu ms]  char %lu  refresh=%lums  pos=%d\n",
                          (unsigned long) millis(),
                          (unsigned long) char_count,
                          (unsigned long) refresh_ms,
                          (int) idx);
        }
    }

    // Pace to TARGET_CHAR_INTERVAL_MS but never sleep negatively.
    const uint32_t elapsed = millis() - loop_start;
    if (elapsed < TARGET_CHAR_INTERVAL_MS) {
        delay(TARGET_CHAR_INTERVAL_MS - elapsed);
    }
}
