# Wiring Guide — Electronic Clapboard (Breadboard Prototype)

> **Power source for prototyping:** Bench PSU set to 12.0V, current-limited to 3A.
> This stands in for the robot harness during development.
>
> **Phases 1–5 below describe the original battery-powered, solenoid-equipped
> build.** They are kept because the LED, e-paper and button wiring is
> unchanged and the test procedures are still the right way to bring those
> sub-circuits up. Two things in them are now superseded — read
> [Phase 6](#phase-6-can-bus--robot-power-v1-final) before building:
>
> | Superseded | Replaced by |
> |---|---|
> | Phase 2's solenoid + flyback + 4700 µF | Nothing — audio sync cut in firmware Phase 11 |
> | 3S LiPo, LVC module, balance alarm | Jugglebot 12 V harness, 0.5 A budget |
> | 10 kΩ / 3.3 kΩ battery divider | Nothing — no rail monitoring at all |

## General breadboard rules

- The ESP32-S3 DevKitC straddles the centre channel of a full-size breadboard. It's wide — confirm it fits before planning rail assignments.
- Use the **top power rail pair** for 12V (PSU output) and the **bottom power rail pair** for 3.3V (from the ESP's 3V3 pin). Label them with tape.
- All grounds connect together: PSU GND, ESP GND, MOSFET sources. Use a thick jumper (or multiple jumpers in parallel) for the shared ground rail — especially from the solenoid MOSFET source back to the PSU GND terminal. Thin breadboard jumpers have ~0.5Ω per contact, and solenoid inrush through a daisy chain of contacts will cause voltage droop.
- Keep high-current paths (LED, solenoid) on one side of the breadboard and signal-level wiring (SPI to e-paper, ADC) on the other. This isn't just tidiness — ground bounce from the solenoid can glitch the SPI bus.
- IRLZ44N pinout (facing the label, legs down): **Gate — Drain — Source**. Double-check this with your specific part's datasheet; some TO-220 FETs swap drain and source.

## Pin map (cumulative, post-Phase-6)

The phases below build up these assignments incrementally. This is the consolidated view — keep it in sync with `include/config.h`.

| Function           | GPIO | Direction | Notes                                                              |
|--------------------|-----:|-----------|--------------------------------------------------------------------|
| LED MOSFET gate    |    4 | OUT       | 220 Ω series + 100 kΩ pulldown to GND. LOW at boot.                |
| Solenoid MOSFET gate | 5  | OUT       | **Reserved, never raised** (firmware Phase 11). Still claimed, still forced LOW at boot and by the pulse-end ISR, so a populated-but-unused MOSFET can't latch on. |
| ~~Rail ADC~~       |    1 | —         | **Not fitted.** Divider removed with the reservoir; `CLAPBOARD_HAS_RAIL_ADC` is 0 and the pin is left floating and unread. |
| **CAN TX**         |   17 | OUT       | To transceiver `D`/`TXD`. Logic-level, **not** CANH.               |
| **CAN RX**         |   18 | IN        | From transceiver `R`/`RXD`. Logic-level, **not** CANL.             |
| EPD MOSI           |   11 | OUT       | SPI to Waveshare HAT.                                               |
| EPD CLK            |   12 | OUT       | SPI to Waveshare HAT.                                               |
| EPD CS             |   10 | OUT       | SPI chip select.                                                    |
| EPD DC             |    9 | OUT       | Data/command. 4-line SPI mode.                                      |
| EPD RST            |    8 | OUT       | Panel reset.                                                        |
| EPD BUSY           |    7 | IN        | Refresh-in-progress signal.                                         |
| EPD PWR            |    6 | OUT       | Panel power gate (HAT rev2.3+). HIGH = on.                          |
| ~~Wake button~~    |    2 | —         | **Not fitted.** Deep sleep retired in Phase 17 and it was the only wake source; `CLAPBOARD_HAS_WAKE_BUTTON` is 0. |
| Fire button        |   14 | IN_PULLUP | Button-to-GND, pressed = LOW.                                       |
| Status LED         |   21 | OUT       | Through 330 Ω. HIGH = awake. (GPIO 13 was tried first but is the Arduino-ESP32 default SPI MISO; `SPI.begin()` clobbered the OUTPUT mode during display init.) |

**Free after Phase 11/13:** GPIO 15, 16, 38–42, 47.

**Not available on this board — do not plan around them:**

| Pins | Why |
|---|---|
| 26–32 | SPI flash |
| 33–37 | Octal PSRAM (N16R8 specifically — these *are* free on non-R8 parts) |
| 43, 44 | UART0 to the USB-serial bridge |
| 19, 20 | Native USB D−/D+. The build sets `ARDUINO_USB_CDC_ON_BOOT=1`, so these belong to the CDC console. The "USB OTG fallback keyboard" idea from the original spec was never compatible with that and is now dropped outright — the editor and the CAN link are the input paths. |
| 48 | Onboard WS2812 RGB LED on the DevKitC-1 |
| 0, 3, 45, 46 | Strapping pins — avoid loading at boot |
| 13 | Technically free, but it is the Arduino-ESP32 default SPI MISO; `SPI.begin()` reclaims it during display init. Burned once already (see Status LED row). |

## Safety checklist before applying power

- [ ] MOSFET gates have 100kΩ pulldown resistors to GND (gate → 100kΩ → GND)
- [ ] MOSFET gates are NOT connected directly to ESP GPIOs yet (we test the FET circuit standalone first)
- [ ] Flyback diode is installed across the solenoid coil BEFORE first power-on (cathode band toward +12V)
- [ ] Wake + fire buttons go to GND only — they do NOT touch the +12 V rail or any MOSFET drain
- [ ] Status LED is wired through its 330 Ω current limiter (no LED-direct-to-GPIO)
- [ ] PSU current limit is set to 3A max
- [ ] No bare wire ends touching each other or the bench
- [ ] Multimeter check: confirm no continuity between +12V rail and GND rail before powering on

---

## Phase 1: LED + MOSFET (no ESP yet)

**Goal:** Confirm the MOSFET switches the LED on/off. We drive the gate manually first, then from the ESP.

### Components
| Part | Notes |
|------|-------|
| IRLZ44N | N-channel logic-level MOSFET (TO-220) |
| 12V LED (or LED + resistor) | Your LED module; if it's a bare LED, add a current-limiting resistor |
| 100kΩ resistor | Gate-to-source pulldown (keeps LED off when gate is floating) |
| 220Ω resistor | Series gate resistor (current-limits gate charge, damps ringing) |
| Jumper wires | Assorted colours. Use red for +12V, black for GND, yellow/white for signal |

### Wiring

```
PSU +12V ──────────────┬──────────────── +12V rail
                       │
                   [LED module]
                   (+ to 12V,
                    - to MOSFET drain)
                       │
              IRLZ44N DRAIN (centre pin)
              IRLZ44N SOURCE (right pin) ──── GND rail
              IRLZ44N GATE (left pin) ──┬──── 100kΩ ──── GND rail
                                        │
                                    [220Ω resistor]
                                        │
                                   gate drive point ← (leave floating for now)

PSU GND ──────────────────────────────── GND rail
```

### Test procedure (manual, no ESP)

1. Power on PSU at 12V, current limit 0.5A initially. LED should be **OFF** (gate pulled low by 100kΩ).
2. Using a jumper wire, briefly touch the gate drive point (the free end of the 220Ω resistor) to the **+12V rail**. The LED should turn ON brightly.
3. Remove the jumper. LED should turn OFF promptly.
4. If the LED stays on or flickers, check: is the 100kΩ pulldown connected? Is the MOSFET inserted correctly (G-D-S)?

### Connect to ESP

1. Power off the PSU.
2. Connect the ESP's GND pin to the common GND rail.
3. Connect GPIO 4 to the gate drive point (the open end of the 220Ω resistor).
4. Upload a minimal test sketch:

```cpp
// Phase 1 test: blink the LED via MOSFET
#define LED_GATE 4

void setup() {
    pinMode(LED_GATE, OUTPUT);
    digitalWrite(LED_GATE, LOW);  // Explicit LOW before anything else
}

void loop() {
    digitalWrite(LED_GATE, HIGH);
    delay(50);                    // 50ms pulse — simulates sync flash
    digitalWrite(LED_GATE, LOW);
    delay(3000);                  // Wait 3 seconds
}
```

5. Power on PSU. The LED should flash briefly every 3 seconds.
6. Confirm with a multimeter: gate voltage should read ~3.3V when HIGH, ~0V when LOW. Drain voltage should read ~0V when LED is on (MOSFET saturated), ~12V when LED is off.

### What success looks like
- LED is completely off at boot (before `setup()` runs) — the 100kΩ pulldown is doing its job
- 50 ms flash is visually crisp and bright
- No visible flicker or partial-on states
- ESP runs stable, no resets

---

## Phase 2: Add solenoid + second MOSFET

**Goal:** Fire the solenoid reliably without disturbing the LED circuit or the ESP.

### Additional components
| Part | Notes |
|------|-------|
| Second IRLZ44N | For the solenoid |
| 100kΩ resistor | Gate pulldown for solenoid MOSFET |
| 220Ω resistor | Gate series resistor for solenoid MOSFET |
| 1N5408 diode (or SS54 Schottky) | Flyback protection across solenoid coil |
| 4700µF 35V electrolytic capacitor | Decoupling, placed right next to the solenoid on the breadboard |
| 12V solenoid | Push or pull type, short stroke |

### Wiring

```
+12V rail ──┬────────────────┬──────────────────────────────────┐
            │                │                                  │
        [LED module]    4700µF cap (+)                     [solenoid coil terminal A]
            │                │                                  │
            │           4700µF cap (-)                    1N5408 cathode (band) ←─┐
            │                │                                  │                  │
            │              GND rail                       [solenoid coil terminal B]
            │                                                   │
    IRLZ44N #1 DRAIN                                   1N5408 anode ──────────────┘
    IRLZ44N #1 SOURCE ── GND                                    │
    IRLZ44N #1 GATE ── 220Ω ── GPIO 4                 IRLZ44N #2 DRAIN
              └── 100kΩ ── GND                         IRLZ44N #2 SOURCE ── GND (fat wire to PSU GND)
                                                       IRLZ44N #2 GATE ── 220Ω ── GPIO 5
                                                                 └── 100kΩ ── GND
```

### Critical notes on the flyback diode

The 1N5408 goes **across the solenoid coil itself**, not across the MOSFET:
- **Anode** connects to the solenoid terminal that goes to the MOSFET drain (the "low" side)
- **Cathode** (the end with the band) connects to the solenoid terminal that goes to +12V (the "high" side)

This means in normal operation the diode is reverse-biased and does nothing. When the MOSFET turns off, the coil's collapsing magnetic field tries to keep current flowing — the diode provides a path for that current, clamping the voltage spike to ~0.7V above the rail instead of letting it arc to 50–100V+ and killing the MOSFET.

**If you install it backwards, it will short-circuit +12V through the solenoid continuously.** Double-check polarity before powering on.

### The 4700µF capacitor

Place this **physically adjacent to the solenoid** on the breadboard, between the +12V rail and GND. Its job is to supply the solenoid's inrush current locally instead of demanding it through long breadboard traces back to the PSU. Observe polarity — the longer lead (or the side without the stripe) is positive.

On a breadboard, the capacitor's leads may not reach both rails — use short jumpers. Keep them fat (or doubled up).

### Test procedure

1. **Solenoid only first.** Disconnect the LED MOSFET gate from GPIO 4 (leave it floating with just the pulldown). Upload:

```cpp
#define SOLENOID_GATE 5
#define SOLENOID_MAX_PULSE_MS 80

void setup() {
    pinMode(SOLENOID_GATE, OUTPUT);
    digitalWrite(SOLENOID_GATE, LOW);
    Serial.begin(115200);
}

void loop() {
    Serial.println("Firing solenoid...");
    digitalWrite(SOLENOID_GATE, HIGH);
    delay(SOLENOID_MAX_PULSE_MS);
    digitalWrite(SOLENOID_GATE, LOW);
    Serial.println("Done.");
    delay(5000);
}
```

2. Power on. Solenoid should snap every 5 seconds. Listen for a clean, crisp strike.
3. Monitor: the ESP should not reset during firing. If it does, your ground path is shared and the solenoid's current spike is pulling the ESP's GND up. Fix: run a dedicated thick wire from the solenoid MOSFET source directly to the PSU negative terminal, bypassing the breadboard GND rail.
4. Check: touch the MOSFET after a few cycles — it should be cool. If warm, something's wrong.

### Then combine LED + solenoid

```cpp
#define LED_GATE 4
#define SOLENOID_GATE 5
#define LED_PULSE_MS 50
#define SOLENOID_PULSE_MS 60

void setup() {
    pinMode(LED_GATE, OUTPUT);
    pinMode(SOLENOID_GATE, OUTPUT);
    digitalWrite(LED_GATE, LOW);
    digitalWrite(SOLENOID_GATE, LOW);
    Serial.begin(115200);
}

void fire_sync() {
    Serial.println("SYNC");
    // Fire both simultaneously
    digitalWrite(LED_GATE, HIGH);
    digitalWrite(SOLENOID_GATE, HIGH);

    // LED off first (shorter pulse)
    delay(LED_PULSE_MS);
    digitalWrite(LED_GATE, LOW);

    // Solenoid stays on a bit longer
    delay(SOLENOID_PULSE_MS - LED_PULSE_MS);
    digitalWrite(SOLENOID_GATE, LOW);
}

void loop() {
    fire_sync();
    delay(5000);
}
```

### What success looks like
- Simultaneous flash + clap on each sync event
- ESP stays stable — no resets, no serial garbage
- MOSFETs stay cool
- Sound is a crisp snap, not a dull thud (tweak pulse width and strike block material)

---

## Phase 3: E-paper display

**Goal:** Get the Waveshare 7.5" V2 showing text, driven by the ESP32-S3 over SPI.

### Additional components
| Part | Notes |
|------|-------|
| Waveshare 7.5" V2 e-paper + driver HAT | Comes with a ribbon cable; the HAT breaks out SPI pins |
| Jumper wires (female-to-male) | To connect HAT header pins to breadboard |

### HAT switch settings

The Waveshare 7.5" V2 HAT has two onboard slide switches. Set them **before** powering on:

| Switch | Setting | Why |
|--------|---------|-----|
| Display Config | **0.47R** | Selects the booster current-sense resistor for the 7.5" V2 panel. The `3R` position is for smaller/lower-current panels. Wrong setting → ghosting, washed-out output, incomplete refreshes. |
| Interface Config | **4-line SPI** | Uses a dedicated DC pin (matches our GPIO 9 wiring and the `GxEPD2_750_T7` driver). 3-line mode multiplexes DC into the SPI stream as a 9th bit per byte — needs a different driver and saves a pin we don't need to save. |

### Wiring

The Waveshare HAT has a standard header. Connect to the ESP32-S3:

| HAT pin | Function | ESP32-S3 GPIO |
|---------|----------|---------------|
| VCC     | 3.3V (logic supply) | 3V3   |
| GND     | Ground   | GND           |
| DIN     | SPI MOSI | GPIO 11       |
| CLK     | SPI CLK  | GPIO 12       |
| CS      | Chip select | GPIO 10    |
| DC      | Data/Command | GPIO 9    |
| RST     | Reset    | GPIO 8        |
| BUSY    | Busy signal | GPIO 7     |
| PWR     | Panel power enable | GPIO 6 |

**Note:** These pin choices avoid the strapping pins on the ESP32-S3 (GPIO 0, 3, 45, 46) which can cause boot failures if loaded. They also avoid GPIO 19/20 which are reserved for USB OTG.

### About the PWR pin

Newer revisions of the Waveshare 7.5" V2 HAT (rev2.3+) expose a **PWR** pin that gates the onboard panel power circuitry — drive it HIGH to power the display, LOW to cut power entirely. Because e-paper retains its image with no power, we wire PWR to a GPIO so firmware can shut the display down between takes. This meaningfully extends battery life on the 3S LiPo.

If your board only has 8 pins (no PWR), it's an older revision — skip this pin and tie nothing; the panel is always-powered whenever VCC is present.

**Firmware sequence for any display update:**
1. Drive `EPD_PWR` HIGH
2. Wait ~10 ms for the panel rails to settle
3. Perform SPI transactions / refresh
4. Wait for BUSY to go inactive (refresh complete)
5. Drive `EPD_PWR` LOW

Never toggle CS, DC, RST, or push SPI data while PWR is LOW — the panel's level shifters are unpowered and you risk latch-up through the protection diodes.

### Library setup

In `platformio.ini`:
```ini
[env:esp32s3]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
lib_deps =
    zinggjm/GxEPD2@^1.5.0
monitor_speed = 115200
board_build.arduino.memory_type = qio_opi
```

### Test sketch

```cpp
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold24pt7b.h>

#define EPD_PWR 6
#define EPD_PWR_SETTLE_MS 10

// Waveshare 7.5" V2 (800x480)
GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT>
    display(GxEPD2_750_T7(/*CS=*/10, /*DC=*/9, /*RST=*/8, /*BUSY=*/7));

void setup() {
    pinMode(EPD_PWR, OUTPUT);
    digitalWrite(EPD_PWR, LOW);   // Panel off until we're ready

    Serial.begin(115200);
    Serial.println("Initialising display...");

    digitalWrite(EPD_PWR, HIGH);
    delay(EPD_PWR_SETTLE_MS);

    display.init(115200);
    display.setRotation(1);  // Landscape
    display.setFont(&FreeMonoBold24pt7b);
    display.setTextColor(GxEPD_BLACK);

    display.setFullWindow();
    display.firstPage();
    do {
        display.fillScreen(GxEPD_WHITE);
        display.setCursor(20, 60);
        display.println("ELECTRONIC");
        display.setCursor(20, 120);
        display.println("CLAPBOARD v0.1");
        display.setCursor(20, 200);
        display.println("Scene: ___");
        display.setCursor(20, 260);
        display.println("Take:  001");
    } while (display.nextPage());

    display.hibernate();          // Tell the controller we're done
    digitalWrite(EPD_PWR, LOW);   // Cut panel power — image remains visible
    Serial.println("Display ready, panel powered down.");
}

void loop() {
    // Nothing yet — just confirming display works
}
```

### Test procedure

1. Power off everything.
2. Wire the e-paper as above. Keep it on the 3.3V/signal side of the breadboard, away from the 12V solenoid/LED side.
3. Upload the sketch.
4. Watch the e-paper — it will flicker through a full refresh cycle (normal, takes 2–4 seconds) and then show the text.
5. Unplug the ESP. The display should **retain the image with no power**. That's e-paper working correctly.

### SPI bus note

The e-paper is the only SPI device in this design, so bus contention isn't an issue. However, if you fire the solenoid while an e-paper refresh is in progress, the ground bounce could corrupt the SPI transfer and leave the display in a bad state. **In firmware, never fire sync during a display refresh.** The state machine enforces this: `SYNC` can only trigger from `IDLE`, and `IDLE` is only entered after a refresh completes.

### What success looks like
- Text appears crisp and high-contrast on the e-paper
- Display holds image after power removed
- ESP doesn't reset during refresh
- No visual artefacts or partial corruption

---

## Phase 4: Buttons + status LED

**Goal:** Wire the two operator-facing buttons (wake, fire) and the device-state status LED, on a different patch of breadboard from the high-current LED + solenoid side. These are pure 3.3 V signals — no MOSFETs needed.

### Why two buttons

| Button | GPIO | Behaviour |
|--------|-----:|-----------|
| **Wake** | GPIO 2 | Single press wakes the device from deep-sleep. Long-press (>= 1 s) while awake puts it back to sleep. RTC-IO capable for `ext0` deep-sleep wake. |
| **Fire** | GPIO 14 | Press fires the LED + solenoid simultaneously (the visual + audio sync pair cameras pick up). Firmware enforces a minimum gap of ~1.5 s between fires and refuses if battery is below `LOW_BATTERY_THRESHOLD_MV`. RTC-IO capable so a future firmware revision can also use it as a wake source. |

Both buttons follow the same wiring idiom: **button to GND, internal pull-up enabled in firmware, pressed = LOW.** No external pull-up resistor needed; the ESP's internal ~45 kΩ pull-up does the job. An optional 10 kΩ + 100 nF RC across the button can be added if firmware debounce alone isn't suppressing the bounce on your specific switch.

### Why GPIO 2 and GPIO 14 specifically

| GPIO | Why this one | Why not others |
|-----:|--------------|----------------|
| **2** | RTC-IO capable, free in the existing pin map, not a strapping pin. | Not GPIO 0/3/45/46 (strapping); not GPIO 1 (battery ADC); not GPIO 4-12 (display + MOSFETs); not GPIO 19/20 (USB OTG). |
| **14** | RTC-IO capable so a future revision can wake on it; not a strapping pin; physically close to GPIO 2 on the DevKitC-1 header so a single button daughterboard or breadboard cluster covers both. | Same exclusions as above. |

### Why GPIO 21 for the status LED

The status LED is HIGH when the device is awake, LOW during deep-sleep / pre-init. Two prior picks were tried and rejected:

- **GPIO 3** samples ROM-message strapping at reset — an LED + resistor weakly pulls it LOW and silences the boot-time debug messages on UART.
- **GPIO 13** is the Arduino-ESP32 default SPI MISO. `SPI.begin()` (called with no args by GxEPD2 inside `display::begin()`) calls `spiAttachMISO(_, 13)`, which reconfigures the pin from OUTPUT back to SPI MISO input. Bench symptom: the LED came on briefly during `power::begin()`, then went dark for the rest of the awake session.

GPIO 21 is not a strapping pin and isn't claimed by any default peripheral on the S3-DevKitC-1, so it stays HIGH as set.

### Components

| Part | Notes |
|------|-------|
| 6 mm tactile push button × 2 | One wake, one fire. Through-hole, 4-leg or 2-leg variants both fit. |
| 3 mm or 5 mm LED | Status indicator. Any colour; green is conventional for "awake". |
| 330 Ω resistor | LED current limiter. ~5 mA at 3.3 V, well within the GPIO drive limit. |
| 10 kΩ resistor × 2 | **Optional**, only if external debounce is needed. |
| 100 nF ceramic cap × 2 | **Optional**, paired with the 10 kΩ for RC debounce. |

### Wiring

```
                  ESP32-S3
                     │
                  [GPIO 2]──────┬──── tactile button A ──── GND   (wake)
                                │
                          (optional debounce:
                           10 kΩ pull-up + 100 nF cap to GND)
                     │
                  [GPIO 14]─────┬──── tactile button B ──── GND   (fire)
                                │
                          (optional debounce:
                           10 kΩ pull-up + 100 nF cap to GND)
                     │
                  [GPIO 21]──── 330 Ω ──── LED anode (long leg)
                                              │
                                          LED cathode (short leg) ──── GND
```

Notes:
- Keep these signals on the **3.3 V / signal side** of the breadboard, away from the 12 V solenoid + LED-driver patch. Button-to-GND lines are low-current but are part of the same wiring fabric — keeping them physically separated from the solenoid return path avoids the same ground-bounce risk that bites the SPI bus.
- If you wire both buttons close together physically, label them clearly. Pressing the wake button when you mean the fire button is harmless (might put the device to sleep mid-take); pressing the fire button when you mean wake fires the solenoid for nothing and burns 30–80 ms of battery.

### Test procedure

1. Power off everything.
2. Wire as above. Confirm with a multimeter that there's no continuity between any GPIO pin and GND with both buttons released, and brief continuity (~0 Ω) when each button is pressed.
3. Power on. Upload a minimal test sketch:

```cpp
#define PIN_WAKE_BUTTON  2
#define PIN_FIRE_BUTTON  14
#define PIN_WAKE_LED     21

void setup() {
    pinMode(PIN_WAKE_BUTTON, INPUT_PULLUP);
    pinMode(PIN_FIRE_BUTTON, INPUT_PULLUP);
    pinMode(PIN_WAKE_LED, OUTPUT);
    digitalWrite(PIN_WAKE_LED, HIGH);  // Awake = LED on
    Serial.begin(115200);
}

void loop() {
    bool wake = digitalRead(PIN_WAKE_BUTTON) == LOW;
    bool fire = digitalRead(PIN_FIRE_BUTTON) == LOW;
    if (wake) Serial.println("WAKE pressed");
    if (fire) Serial.println("FIRE pressed");
    delay(50);
}
```

4. Press each button. The serial monitor should print the corresponding line at ~20 Hz while held.
5. Release. The line should stop printing within one loop iteration.
6. The LED should be on solidly throughout (no flicker).

### What success looks like

- Each button press lights up the serial output with no false negatives (held button always reads LOW).
- No spurious presses when the other button is pressed (no cross-coupling through ground).
- Status LED is on continuously while powered (no flicker, no dim state).

### Wiring this into the real firmware

The Phase 8 firmware (`src/power.cpp`) implements the wake button's debounced press detection and long-press-to-sleep. The fire button follows the same pattern (`src/fire.{cpp,h}` + a pure `src/fire_state.h` state machine; both linked into `[env:native]` for unit testing). The Arduino-side glue is:

- Initialise both buttons with `INPUT_PULLUP` at the very top of `setup()`, alongside the MOSFET-LOW-first invariant.
- Poll both from `loop()` at no slower than 50 Hz so debounce + long-press detection are responsive.
- The fire state machine refuses presses during cooldown (1.5 s default, `MIN_FIRE_GAP_MS` in `include/config.h`) and when battery is below `LOW_BATTERY_THRESHOLD_MV`.

---

## Phase 5: Integration

Once all four phases work independently, integrate them:

1. Merge the test sketches into the real `src/main_net.cpp` with the network firmware
2. Confirm the wake button puts the device to sleep on long-press and wakes it on single-press
3. Confirm the fire button fires the LED, with the minimum gap enforced and rail-low refusal
4. Add rail voltage monitoring (use the PSU voltage through the divider)
5. Test the full sync sequence: edit a slate in the browser → Send → display updates → press fire button → LED flashes → timestamp logged to Serial and visible in `GET /status`

---

## Phase 6: CAN bus + robot power (v1 final)

This is the build that ships. It replaces the battery with a drop off the
Jugglebot 12 V harness and adds a CAN transceiver so the robot can drive the
slate contents.

### The governing constraint

The 12 V harness is **shared with the Jetson and every other 5 V/12 V
peripheral on the robot**. The clapboard's budget is **< 0.5 A at all times**.

**Measured 2026-08-16** on a 12.0 V bench PSU with the whole board assembled:

| Condition | Draw @ 12 V |
|---|---|
| Idle, Wi-Fi associated, LED off | ~0.10 A |
| **LED on, steady** | **0.35 A** |
| **LED on + full-screen e-paper refresh (worst case)** | **0.38 A** |
| CAN transceiver (added after the measurement) | ~0.05 A |
| **Worst-case total** | **~0.43 A** |

~0.07 A of headroom. Re-measure after any hardware change: flip
`CLAPBOARD_LED_HOLD_MODE` to `1` in `include/config.h` and the fire button
becomes a hold switch so the LED can be left on while you read the PSU.

### The reservoir cap was designed, then deleted

An earlier revision of this guide specified a 10,000 µF reservoir and a 27 Ω
charge resistor so the flash could exceed the rail budget. **The measurement
above retired it**, and the reasoning is worth keeping because it is
counter-intuitive:

A reservoir only pays when peak power far exceeds the average budget, and you
would normally exploit the 3.3% duty cycle to get ~10×. **Inrush blocks that.**
A cap bank hitting a shared rail draws `V/R` at plug-in, which must respect the
same 0.5 A — so a genuinely bright 20 W flash needs `R ≥ 27 Ω`, hence ~32 mF,
hence a **3.4 s** refractory period. The ceiling and the duty-cycle advantage
are in direct conflict and the ceiling wins. The 10,000 µF design delivered
5.4 W against 4.2 W for direct drive: a 1.3× gain for three parts and a whole
failure mode.

**Bring it back only if** the flash reads as too subtle on camera *and* you
accept a multi-second refractory. Nothing in the firmware depends on it —
`MIN_FIRE_GAP_MS` survives as a UX affordance, not an electrical constraint.

### Topology

```
  Jugglebot 4-wire harness
  ┌─────────────────────────────────────────────┐
  │  +12V ──┬── FUSE 1A ──┬── SCHOTTKY (revpol) │
  │         │             │                     │
  │  GND ───┼─────────────┼──── star point ●    │
  │  CANH ──┼───┐         │                     │
  │  CANL ──┼─┐ │         │                     │
  └─────────┘ │ │         │
              │ │         ├──── 12V → buck → 5V → ESP32-S3 5V pin
              │ │         │
              │ │         └──── LED+ ─ [LED] ─ LED− ─ IRLZ44N drain
              │ │                                      │
              │ │                                    source
              │ │                                      │
              │ │                                 ● star GND
              │ │
              │ └── CANL ─┐
              └── CANH ─┐ │
                        │ │
                   SN65HVD230 breakout
                   VCC 3V3 · GND · D→GPIO17 · R→GPIO18
```

No reservoir, no charge resistor, no ADC divider. The LED draws straight from
the rail through its MOSFET, and the firmware's `LED_PULSE_MS` (50 ms) bounds
the burst.

### About the LED module

With the reservoir gone there is no droop, so **an off-the-shelf 12 V LED
module with an internal constant-current driver is now the easy choice** — the
earlier guidance pushing you toward a bare COB existed only because a
drooping supply upsets internal drivers.

The one requirement: **rated for continuous 12 V operation**, and drawing
**≤ 0.30 A** so the total stays inside budget with the transceiver fitted.
The firmware's bench hold-mode will happily leave it lit for 30 s, and a
module rated only for pulsed operation would cook.

Thermally trivial: 0.35 A × 12 V × 50 ms = 0.21 J per flash, worst case every
1.5 s → **0.14 W average**.

### No rail ADC

GPIO 1 is unconnected and `CLAPBOARD_HAS_RAIL_ADC` is `0`. With a stiff
supply that is either present or absent, an ADC tells you nothing useful — if
the rail sags far enough to matter the ESP32 browns out before any threshold
logic could run.

> **Do not simply repopulate the divider and expect it to work.** Set
> `CLAPBOARD_HAS_RAIL_ADC` to `1` in the same change. Left at `0` the firmware
> never reads the pin; flipped to `1` without fitting the divider, it reads a
> floating pin whose drifting noise will cross any threshold and make the fire
> button intermittently refuse — a fault that looks like bad wiring.

### CAN transceiver

**Part:** SN65HVD230 breakout (the common blue "VP230" board). Native 3.3 V
supply and logic, no level shifting, fine at 1 Mbps.

| Transceiver pin | Connect to |
|---|---|
| `VCC` / `3V3` | ESP32 **3V3** (not 5 V — this part is a 3.3 V device) |
| `GND` | Star ground |
| `D` / `TXD` | GPIO **17** |
| `R` / `RXD` | GPIO **18** |
| `Rs` / `S` | GND (or leave to the breakout's onboard resistor — high-speed mode) |
| `CANH` | Harness CANH |
| `CANL` | Harness CANL |

**Termination — check this, don't assume.** A CAN bus needs exactly **two**
120 Ω terminators, one at each physical end. With the clapboard as the only
peripheral on CAN3, the bus is bridge ↔ clapboard, so both ends are terminated
and the clapboard's end is one of them. Most SN65HVD230 breakouts ship with a
120 Ω resistor already fitted — verify with a multimeter across CANH/CANL with
everything unpowered and unplugged: **you should read ~60 Ω** across the
assembled bus (two 120 Ω in parallel). 120 Ω means one terminator is missing;
40 Ω means someone fitted a third.

### Grounding

The flash pulls a third of an amp for 50 ms, and the CAN transceiver's
signalling is referenced to the same ground. Star-ground at the harness
connector so flash return current and transceiver ground return do not share
a conductor.

### What comes out of the build

| Removed | Added |
|---|---|
| 3S LiPo | 12 V harness drop (4-wire: +12, GND, CANH, CANL) |
| Low-voltage cutoff module, balance alarm | — (rail is the robot's problem now) |
| 5 A fuse | 1 A fuse (tight, because the rail is shared) |
| Solenoid + IRLZ44N + 1N5408 | — (audio sync is v2) |
| 4700 µF solenoid decoupling | — (no reservoir; see above) |
| 10 kΩ / 3.3 kΩ ADC divider | — (no rail monitoring) |
| Wake button | — (deep sleep retired; GPIO 2 unpopulated) |
| — | SN65HVD230 transceiver breakout |
| — | Schottky reverse-polarity diode (SS34 or similar) |

### Safety checklist before first connection to the robot

- [ ] **Bench-test the whole board on a current-limited PSU at 0.5 A first.** If it trips, find out why on the bench, not on the rail feeding the Jetson.
- [ ] Fuse fitted and rated 1 A
- [ ] Reverse-polarity Schottky fitted, band toward the load
- [ ] LED module rated for **continuous** 12 V and drawing ≤ 0.30 A
- [ ] Measure total draw with the LED lit (`CLAPBOARD_LED_HOLD_MODE 1`) — expect ~0.40 A with the transceiver fitted
- [ ] Confirm ~60 Ω across CANH/CANL on the assembled, unpowered bus
- [ ] Confirm transceiver VCC is on 3V3, not 5 V
- [ ] LED MOSFET gate still has its 100 kΩ pulldown
- [ ] GPIO 1 and GPIO 2 left unconnected (no divider, no wake button)

### Bring-up order

1. Power the board from a **bench PSU at 12 V, limit 0.5 A** — harness disconnected. Confirm boot, Wi-Fi association, `GET /status`. Note the idle current (~0.10 A).
2. Fire the button. Watch the PSU current: a ~0.35 A step for 50 ms. Nothing to recover — the LED draws from the rail directly.
3. Connect CANH/CANL to the harness with **12 V still from the bench PSU**. Confirm the clapboard's 10 Hz heartbeat appears on the bus and that `0x7DD` time-sync frames start arriving once the bridge's presence gate opens.
4. Only then move the 12 V feed to the harness.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| LED stays on at boot | Missing 100kΩ pulldown on gate | Add the resistor |
| ESP resets when solenoid fires | Ground bounce — solenoid return current going through ESP GND | Dedicated thick wire from solenoid MOSFET source to PSU GND |
| E-paper shows nothing | SPI wiring wrong, or wrong GxEPD2 driver class | Double-check pin mapping; confirm `GxEPD2_750_T7` matches your panel revision |
| E-paper init hangs / BUSY never deasserts | PWR pin left LOW or floating on rev2.3+ HAT | Drive `EPD_PWR` HIGH and wait 10 ms before calling `display.init()` |
| E-paper shows garbled image | SPI signal integrity — long wires or ground noise | Shorten SPI wires, add 100nF ceramic cap between VCC and GND near the HAT |
| Solenoid clicks weakly | Insufficient current — breadboard contact resistance | Bypass breadboard: solder the solenoid power wires directly to the PSU leads for testing |
| MOSFET gets hot | Not fully enhanced (Vgs too low) or continuous conduction | Verify gate sees 3.3V; verify pulse code turns off; check for code hang |
| Serial monitor shows resets | Brownout — 3.3V rail sagging during solenoid/LED fire | Separate ground return paths; add 100µF cap on ESP 3V3 pin |
| Wake / fire button reads as pressed continuously | Wired without `INPUT_PULLUP` or with an external pull-down by mistake | The convention is button-to-GND with internal pull-up; `pinMode(PIN, INPUT_PULLUP)` then read LOW = pressed |
| Wake / fire button registers multiple presses per physical click | Bounce on a cheap tactile switch | Firmware debounce in `power.cpp` / `fire.cpp` should suppress this; if not, add the optional 10 kΩ + 100 nF RC across the button |
| Total draw over 0.5 A | LED module too hungry | It must draw ≤ 0.30 A so the ~0.10 A logic and ~0.05 A transceiver still fit. Measure with `CLAPBOARD_LED_HOLD_MODE 1` |
| Fire button intermittently does nothing | `CLAPBOARD_HAS_RAIL_ADC` set to 1 without fitting the divider | A floating GPIO 1 reads drifting noise that crosses the threshold. Set it back to 0, or fit the divider |
| Device sleeps and never wakes | `CLAPBOARD_HAS_WAKE_BUTTON` set to 1 with no button fitted | A floating GPIO 2 reading LOW for a second triggers sleep entry, and the wake source is the same absent button. Power-cycle, set it back to 0 |
| No CAN frames received, and the bridge reports `tx_gated` climbing | The bridge's bus-partner presence gate is closed — it will not transmit until it sees a frame from us | The clapboard must heartbeat unconditionally at boot, regardless of whether it has heard anything. Check the heartbeat is running before blaming the bridge |
| CAN errors under load, transceiver warm | Termination wrong | ~60 Ω across an assembled unpowered bus. 40 Ω means a third terminator is fitted somewhere |
| CAN works on the bench, fails on the robot | Ground bounce from the flash, or a ground loop through the harness | Star-ground at the connector; flash return must not share a conductor with transceiver ground |
| CAN silent, transceiver seems dead | `VCC` on 5 V | SN65HVD230 is a 3.3 V part — it must be on 3V3 |
| Status LED stays dark with the device awake | LED in backwards or wrong-polarity wiring | Long leg = anode to GPIO 21 via 330 Ω; short leg = cathode to GND |
| Fire button does nothing | Battery below `LOW_BATTERY_THRESHOLD_MV`, or last fire was less than `MIN_FIRE_GAP_MS` ago, or fire state machine is in a refusing state | Check `GET /status` for `fire_ready: false` reason; charge the pack or wait the cooldown |
| Pressing fire while a frame is rendering does nothing | Render blocks `loop()` so the fire poll can't sample | Acceptable — not a bug. Don't sync mid-render anyway. |
