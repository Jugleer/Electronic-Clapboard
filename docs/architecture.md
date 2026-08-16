# Software Architecture

> Status: current as of Phase 17. **This document was rewritten in full** —
> it previously described a battery-powered, keyboard-driven slate with a
> solenoid, none of which survives. See
> [phased-build-plan.md](phased-build-plan.md) Part II for how it got here.

## The shape of the system

The device has two transports with a clean split of duties, and almost every
architectural decision follows from that split.

```
┌──────────────┐   ROS2 action    ┌─────────────┐    UDP    ┌───────────┐
│  ROS2 node   │ ───────────────► │   Jetson    │ ────────► │  Teensy   │
│ (shot data)  │ ◄─────────────── │ teensy_     │ ◄──────── │ can-bridge│
└──────────────┘   result (ack)   │ bridge_node │  CONE_    └─────┬─────┘
                                  └─────────────┘  FRAME          │ CAN3
                                                                  │ 1 Mbps
                                                          ┌───────▼────────┐
┌──────────────┐      HTTP        ┌───────────────────────┤  ESP32-S3      │
│  Browser     │ ───────────────► │  templates + slates   │  - composites  │
│  editor      │   POST /template │  in LittleFS          │  - drives EPD  │
│  (authoring) │   POST /frame    └───────────────────────┤  - flashes LED │
└──────────────┘                                          └────────────────┘
```

**HTTP carries authoring; CAN carries runtime.** A 48 KB frame over classic
CAN is 6,000 frames — about 0.67 s of *100%* bus occupancy — against ~5 ms for
a field update. So bitmaps only ever arrive over Wi-Fi, and the bus carries
text. Contract: [protocol.md](protocol.md), §1–§6 HTTP and §8 CAN.

## Display mode is the top-level state

There is no `IDLE`/`EDITING`/`SYNC` machine. What the panel shows is resolved
from CAN liveness, and everything else hangs off that.

| Mode | Entered when | Shows |
|---|---|---|
| `Screensaver` | boot, and every failure path | stored slates, cycling |
| `Scene` | ROS2 demonstrably up | active template + live fields |

Arbitration lives in [`mode_state.h`](../src/mode_state.h) as pure logic and
is specified in [protocol.md §8.5](protocol.md). The design intent is that
**the panel doubles as a ROS2 health indicator**, which is why every failure
converges on `Screensaver`: "screensaver showing" must be a true statement
about upstream health in *every* mode, including the ones where nobody is
left alive to send a message.

Push (`CLAP_LINK`) is primary; two staleness rules are backstops. Push alone
would leave the last scene frame up when the bridge itself dies — displaying
the healthiest state during the severest failure.

## Module layout

| Module | Responsibility |
|---|---|
| `main_net.cpp` | `setup()`/`loop()`; init order is load-bearing (see below) |
| `config.h` | Pins, timings, and the `CLAPBOARD_HAS_*` hardware flags |
| `can.{h,cpp}` | TWAI transport, heartbeat, time-sync slave, frame dispatch |
| `slate.{h,cpp}` | Active template, mode driver, composite-and-push, `/slate` |
| `framebuffer.{h,cpp}` | 48 KB PSRAM `Adafruit_GFX` surface with a clip rect |
| `text_render.{h,cpp}` | GFX font table, advance tables, `draw_field` |
| `template_store.{h,cpp}` | LittleFS `/templates/`, atomic writes, reconcile |
| `frame.{h,cpp}` | `POST /frame` — the browser's direct-to-panel path |
| `screensaver.{h,cpp}` | Slate storage and the awake cycle |
| `display.{h,cpp}` | GxEPD2 wrapper |
| `fire.{h,cpp}` | Fire button, LED pulse, hardware-timer watchdog |
| `net.{h,cpp}` | Wi-Fi, mDNS, HTTP server, `/status` |

### The pure/impure boundary

Header-only, Arduino-free, and linked into `[env:native]`:

`fire_state.h` · `power_state.h` · `lockin_state.h` · `screensaver_state.h` ·
`can_frames.h` · `text_fit.h` · `region.h` · `template_wire.h` ·
`clap_txn.h` · `mode_state.h`

This is the most load-bearing convention in the codebase. Every rule worth
arguing about — what truncates, what a valid transaction is, which mode to
show — lives in one of those headers and is tested without hardware. The
`.cpp` files do transport, allocation and pixels.

It also pays off in unexpected places: cutting audio sync in Phase 11 required
no change to `fire_state.h`, because the state machine never knew how many
emitters existed.

## Concurrency

Three contexts touch shared state, and mixing them up is the main hazard.

| Context | Runs | Must not |
|---|---|---|
| `loop()` | 50 ms tick; all rendering | — |
| CAN RX task | priority 2, core 0 | block; touch LittleFS or the panel |
| AsyncTCP task | HTTP handlers | block for more than ~1 s |
| `hw_timer_t` ISR | pulse end | anything but a GPIO register write |

**Rendering happens only in `loop()`.** The panel blocks for 1.5–3.5 s, which
is fatal on either of the other two tasks — LWIP and the watchdog both object.
So HTTP handlers and CAN commits set `g_render_pending` and return; `loop()`
does the work. This is the same deferred-lock-in discipline `frame.cpp` uses.

The corollary is that `CLAP_ACK`'s `render_ms` reports the *previous* render's
duration: waiting for the real figure would stall time-sync reception for the
whole refresh.

## Init order in `setup()`

Not arbitrary — three orderings are required:

1. `hold_high_current_rails_low()` **first**, before anything else. GPIOs
   float during boot.
2. `framebuffer` and `text_render` before `slate`, but `slate::begin()` after
   `screensaver::begin()` — the latter is what mounts LittleFS, and
   `slate::begin()` adopts a stored template. Getting this wrong made boot-time
   adoption silently fail and revert to the built-in on every reboot.
3. `can_link::begin()` before the Wi-Fi association wait. The heartbeat must
   start immediately: the bridge will not transmit to a bus where it has not
   seen a partner frame within 5 s, so a clapboard that waits to be spoken to
   never will be.

## Invariants

- MOSFET gates are LOW from the first instruction of `setup()`, including the
  reserved solenoid gate that nothing raises.
- The flash pulse duration is bounded by a hardware-timer ISR, independent of
  FreeRTOS scheduling, AsyncTCP depth and display SPI.
- A rejected CAN transaction applies nothing. Partial application would leave
  the operator unable to tell which fields are current.
- Text drawing is clipped to its region, so an oversized font degrades to cut
  glyphs rather than painting over a neighbouring field.
- Every failure path in mode arbitration resolves to `Screensaver`.

## Resolved from the original open questions

- **Keyboard input** — dropped entirely. The browser editor is the authoring
  path and CAN is the runtime path.
- **Label persistence** — templates in LittleFS; field values are deliberately
  *not* persisted, because Scene entry clears them (a stale take number read
  as current is worse than a blank one).
- **Timestamp source** — the bridge's 100 Hz `0x7DD` broadcast, which is
  strictly better than the NTP-during-a-Wi-Fi-session approach it replaced.
