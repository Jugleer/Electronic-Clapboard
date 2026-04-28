# Wiring Guide — Electronic Clapboard (Breadboard Prototype)

> **Power source for prototyping:** Bench PSU set to 12.0V, current-limited to 3A.
> This stands in for the 3S LiPo during development.

## General breadboard rules

- The ESP32-S3 DevKitC straddles the centre channel of a full-size breadboard. It's wide — confirm it fits before planning rail assignments.
- Use the **top power rail pair** for 12V (PSU output) and the **bottom power rail pair** for 3.3V (from the ESP's 3V3 pin). Label them with tape.
- All grounds connect together: PSU GND, ESP GND, MOSFET sources. Use a thick jumper (or multiple jumpers in parallel) for the shared ground rail — especially from the solenoid MOSFET source back to the PSU GND terminal. Thin breadboard jumpers have ~0.5Ω per contact, and solenoid inrush through a daisy chain of contacts will cause voltage droop.
- Keep high-current paths (LED, solenoid) on one side of the breadboard and signal-level wiring (SPI to e-paper, ADC) on the other. This isn't just tidiness — ground bounce from the solenoid can glitch the SPI bus.
- IRLZ44N pinout (facing the label, legs down): **Gate — Drain — Source**. Double-check this with your specific part's datasheet; some TO-220 FETs swap drain and source.

## Pin map (cumulative, post-Phase-4)

The phases below build up these assignments incrementally. This is the consolidated view — keep it in sync with `include/config.h`.

| Function           | GPIO | Direction | Notes                                                              |
|--------------------|-----:|-----------|--------------------------------------------------------------------|
| LED MOSFET gate    |    4 | OUT       | 220 Ω series + 100 kΩ pulldown to GND. LOW at boot.                |
| Solenoid MOSFET gate | 5  | OUT       | Same idiom. Hardware-watchdog-enforced LOW after `SOLENOID_MAX_PULSE_MS`. |
| Battery ADC        |    1 | IN (ADC)  | Through 10 kΩ / 3.3 kΩ divider; scales 12 V down to ~3 V.           |
| EPD MOSI           |   11 | OUT       | SPI to Waveshare HAT.                                               |
| EPD CLK            |   12 | OUT       | SPI to Waveshare HAT.                                               |
| EPD CS             |   10 | OUT       | SPI chip select.                                                    |
| EPD DC             |    9 | OUT       | Data/command. 4-line SPI mode.                                      |
| EPD RST            |    8 | OUT       | Panel reset.                                                        |
| EPD BUSY           |    7 | IN        | Refresh-in-progress signal.                                         |
| EPD PWR            |    6 | OUT       | Panel power gate (HAT rev2.3+). HIGH = on.                          |
| Wake button        |    2 | IN_PULLUP | Button-to-GND, pressed = LOW. RTC-IO capable for `ext0` deep-sleep wake. |
| Fire button        |   14 | IN_PULLUP | Button-to-GND, pressed = LOW. RTC-IO capable.                       |
| Status LED         |   13 | OUT       | Through 330 Ω. HIGH = awake.                                        |
| USB D−             |   19 | —         | Reserved for native USB OTG (fallback keyboard host).               |
| USB D+             |   20 | —         | Reserved for native USB OTG.                                        |

Strapping pins (avoid loading at boot): GPIO 0, 3, 45, 46. None are used here.

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

### Why GPIO 13 for the status LED

The status LED is HIGH when the device is awake, LOW during deep-sleep / pre-init. GPIO 3 was rejected because it samples ROM-message strapping at reset — an LED + resistor weakly pulls it LOW and silences the boot-time debug messages on UART. GPIO 13 has no boot-time role.

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
                  [GPIO 13]──── 330 Ω ──── LED anode (long leg)
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
#define PIN_WAKE_LED     13

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
3. Confirm the fire button fires LED + solenoid simultaneously, with the 1.5 s minimum gap enforced and battery-low refusal
4. Add battery voltage monitoring (use the PSU voltage through the divider — it'll read ~12V, which is in the 3S range)
5. Test the full sync sequence: edit a slate in the browser → Send → display updates → press fire button → LED flashes + solenoid strikes → timestamp logged to Serial and visible in `GET /status`

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
| Status LED stays dark with the device awake | LED in backwards or wrong-polarity wiring | Long leg = anode to GPIO 13 via 330 Ω; short leg = cathode to GND |
| Fire button does nothing | Battery below `LOW_BATTERY_THRESHOLD_MV`, or last fire was less than `MIN_FIRE_GAP_MS` ago, or fire state machine is in a refusing state | Check `GET /status` for `fire_ready: false` reason; charge the pack or wait the cooldown |
| Pressing fire while a frame is rendering does nothing | Render blocks `loop()` so the fire poll can't sample | Acceptable — not a bug. Don't sync mid-render anyway. |
