# Jugglebot-side implementation brief — Electronic Clapboard on CAN3

**Audience:** a Claude Code session working in the **Jugglebot** repo
(`../Jugglebot/`), not this one.
**Prerequisite reading:** [protocol.md §8](protocol.md) — the wire contract.
That document is normative; this one tells you where to put things and what
the traps are.

> **Clapboard-side status: code-complete as of 2026-08-16.** Every frame in §8
> is implemented and the firmware is on hardware. `CLAP_HEARTBEAT`,
> `CLAP_FIRE_EVENT` and the `0x7DD` time-sync slave are hardware-validated;
> `CLAP_FIELD`/`COMMIT`/`ACK` ingest and `CLAP_LINK` mode arbitration build
> and are unit-tested but have never seen a real frame, because `CLAP_LINK`
> does not exist on the bridge yet.
>
> Two things this changes for you:
> - **You can test against a live clapboard immediately.** Its heartbeat is
>   already on CAN3 at 10 Hz, so the bridge's TX presence gate should already
>   be open.
> - **[protocol.md §8.11](protocol.md) has bench-injection frames**, including
>   a worked transaction with a correct CRC. Use them to sanity-check your
>   encoder against a device that is known to accept them, before wiring the
>   ROS2 action on top.
>
> §8 also gained two subsections after this brief was first written —
> **§8.4's transaction-semantics table** (all-or-nothing, idempotent replay,
> why `BUSY` is not terminal) and **§8.10's device limits**. Read both before
> writing the action server's retry logic; they determine what a retry is
> allowed to assume.

---

## 0. Context in one paragraph

The Electronic Clapboard is a film slate with an 800×480 e-paper panel and a
high-power sync flash. It is being re-targeted from a battery-powered,
Wi-Fi-commanded device into a peripheral on the Jugglebot 12 V + CAN harness.
It stores **templates** (background bitmaps with up to 8 named text regions)
authored over Wi-Fi from a browser editor, and receives **field values** over
CAN — "scene 4, take 12, wide shot" — which it composites into the template
and paints. It also flashes an LED for multi-camera sync, and reports the
wall-clock instant of each flash back to ROS2.

**The clapboard does not take fire commands.** Firing stays button-only, by
design. ROS2 gets a complete log of every clap; it does not get to clap.

---

## 1. What already exists in your favour

Read these before writing anything — three of the five work items are smaller
than they look because the infrastructure is already there.

| Existing mechanism | Where | Why it matters here |
|---|---|---|
| Every CAN3 frame is relayed verbatim to the Jetson | `can_buses.cpp` `on_cone_rx()` → SPSC ring → `telemetry.cpp` `cone_uplink_step()` → `CONE_FRAME` UDP | **The entire clapboard→Jetson uplink needs no new Teensy code.** Only the Jetson-side handler must learn the new IDs. |
| `0x7DD` time-sync already broadcasts on all three buses | `time_sync_master.cpp` `broadcast_0x7dd()` | Gives the clapboard wall-clock for free. Also — see §3 — it is *already* a ROS2-liveness signal. |
| Jetson link-loss is already computed | `LINK_LOST` fault cause; `LINK_LOST_MISSES` (5) × `HEARTBEAT_HZ` (10) = 500 ms | The `CLAP_LINK` emitter is a thin wrapper over a signal you already have. |
| Bus-partner TX gate | `can_buses.cpp` `partner_recent()` / `can_cone_send()` | Works in your favour unmodified: the clapboard's 10 Hz heartbeat is exactly the partner frame the gate waits for. |

### The one thing that is *not* in your favour

`can_cone_send()` is currently only ever called by the time-sync fan-out.
There is **no general "send an arbitrary frame on the CAN3 bus" RPC**. That is
work item 2 and it is the largest of the five.

---

## 2. Bus identity — read this carefully, it is counter-intuitive

The clapboard connects to what the harness labels **CAN3**. On the can-bridge
that is the **CAN3 peripheral**, which since 2026-07-31 hosts the **cone
role** — the roles were swapped because CAN3's analog drive path developed a
load-dependent fault and could not sustain the 8-node Jugglebot chain. The
Jugglebot core bus lives on the **CAN2 peripheral** now. See the comment block
at `can_buses.cpp:27-41`.

Consequences you must hold in your head:

1. **All the code you touch is named `cone`**, not `clapboard`. `can_cone_send`,
   `on_cone_rx`, `s_cone_ring`, `CONE_FRAME`. The names are role-keyed and the
   role is being extended, not replaced.
2. **The cone and the clapboard are mutually exclusive by physical
   connection.** The clapboard is the sole peripheral on the segment. You do
   not need to handle both being present, and you should assert rather than
   accommodate if you ever see both ID ranges.
3. **CAN3's drive path is known-degraded** and tolerates light load only. The
   clapboard is deliberately quiet (10 Hz heartbeat + ~41 frames per take).
   If this bus starts misbehaving after the clapboard lands, the drive path is
   the prime suspect, not the new code. Do not add polling, do not add
   high-rate telemetry.

---

## 3. Work item 1 — `CLAP_LINK` emitter (small)

**Where:** `Teensy_code_canbridge/`, alongside `time_sync_master.cpp`.

Emit `0x7EA` at **2 Hz** on the cone bus with byte 0 = 1 when the Jetson link
is up, 0 when it is down. Bytes 1–7 zero. Derive the state from the existing
`LINK_LOST` machinery.

### Why 2 Hz and not the 10 Hz used elsewhere

The clapboard treats a 3 s gap as "the bridge is dead". 2 Hz gives six
missed frames of margin before that fires, which is generous, and it keeps a
degraded bus quiet. Do not raise it.

### Why this exists at all when `0x7DD` already signals liveness

`broadcast_0x7dd()` opens with `if (!time_synced()) return;`, and
`time_synced()` goes false `TIME_ANCHOR_STALE_US` (90 s) after the last
successful time-of-day RPC. So `0x7DD` *stopping* already means ROS2 is gone
— but 90 s later than you know it internally. `CLAP_LINK` exists purely to
close that latency gap. The clapboard uses `0x7DD` absence as a backstop and
`CLAP_LINK` as the primary signal.

**Do not "optimise" by deleting `CLAP_LINK` and relying on `0x7DD` alone**, and
do not remove the clapboard's backstop either. Push covers the case where the
bridge is alive to speak; staleness covers the case where it is not. A
push-only design displays the *healthiest* state during the *severest* failure
(dead Teensy, pulled cable), which defeats the point — the clapboard's display
is meant to be readable as a health indicator.

---

## 4. Work item 2 — downlink RPC (medium, the main event)

**Where:** `Teensy_code_canbridge/rpc.cpp`, `udp_protocol.h`, and
`config/generate_udp_protocol.py`.

The Jetson needs to get `CLAP_FIELD` (`0x7E8`) and `CLAP_COMMIT` (`0x7E9`)
frames onto the cone bus. Add an RPC method in the style of the existing
`BB_THROW` (`0x0040`) relay — typed, validated, returning a status.

### Suggested shape

```
RpcMethod::CLAP_SEND = 0x0060   // next free block after HAND_TRAJ_CMD 0x0054
```

Argument: a count plus up to N pre-built 8-byte CAN payloads with their IDs,
so one RPC carries a whole transaction. A full 8-field update is 41 frames;
at `MAX_PAYLOAD = 1024` you can carry ~100 frames of `(id, len, buf)` in a
single request, so one RPC per transaction is comfortable and keeps the
Teensy's role purely mechanical.

### Design constraints — these are not negotiable

- **Regenerate, don't hand-edit.** `udp_protocol.h`, `teensy_link/protocol.py`
  and `docs/teensy-udp-protocol.md` are all generated by
  `config/generate_udp_protocol.py`. Edit the generator.
- **Bump `PROTOCOL_VERSION`** (currently 5). Both sides validate it.
- **Respect the TX gate.** `can_cone_send()` returns false when the partner
  is stale. Surface that as an RPC error — do not retry in firmware, and do
  not bypass the gate. Bypassing it is how you get TEC pinned at
  error-passive on a bus whose drive path is already marginal.
- **Do not burst.** Existing callers deliberately send one frame per tick.
  The TX ring is 64 deep but the bus is fragile; pace the frames.

### What the Teensy must *not* do

No reassembly, no CRC checking, no field-model awareness. The Teensy is a
mechanical relay: bytes in, frames out. All validation lives on the clapboard
(which owns the templates) and in the ROS2 node (which owns the field
semantics). Putting protocol knowledge in the bridge would mean a clapboard
protocol change requires a Teensy reflash, and the whole point of the
byte-relay design is that it doesn't.

---

## 5. Work item 3 — `cone_health` must stop lying (small)

**Where:** `can_buses.cpp`, `health_of()` and its call site at line ~820.

`cone_health` is derived from `s_cone_last_rx_us`, which is stamped by *any*
frame on that bus. Once the clapboard heartbeats, the bridge will report a
catching cone as present when there is a clapboard attached instead.

**Fix:** discriminate on arbitration ID in `on_cone_rx()`. Frames in
`0x7E0`–`0x7E1` are cone; `0x7E8`–`0x7EF` are clapboard. Keep one shared
timestamp for the **TX presence gate** (any partner will do — the gate only
cares that *someone* is there to ACK), and add a second, ID-discriminated
timestamp pair for **health reporting**.

Then surface both. The heartbeat's `flags` field already has a
`CONE_HEALTH_MASK` at `HEARTBEAT_CONE_HEALTH_SHIFT` (bit 4, 2 bits wide);
adding a clapboard-present bit alongside is the minimal change. Keep the
existing `cone_health` semantics exactly as they are for the cone — do not
redefine a wire field that other consumers already read.

> **Do not skip this as cosmetic.** `cone_health` feeds operator-facing status.
> A field that silently reports the wrong peripheral is worse than one that
> reports nothing, because it will be believed.

---

## 6. Work item 4 — Jetson-side `CONE_FRAME` handler (small)

**Where:** `ros_ws/src/jugglebot/jugglebot/teensy_bridge_node.py`, around
`self._client.subscribe(int(MsgType.CONE_FRAME), self._on_cone_frame)` (line
~735).

The handler currently assumes cone semantics. Dispatch on arbitration ID:

| ID | Action |
|---|---|
| `0x7E0`, `0x7E1` | Existing cone path, unchanged |
| `0x7EB` `CLAP_ACK` | Resolve the pending transaction (see §7) |
| `0x7EC` `CLAP_HEARTBEAT` | Publish clapboard state; drive a diagnostic topic |
| `0x7ED` `CLAP_FIRE_EVENT` | Publish the flash timestamp — this is the sync record for post-production |
| `0x7E8`–`0x7EA` | Should never arrive uplink; log once and drop |

The note at line ~781 says downstream consumers (`catch_correlation_node`,
analysis tooling) must see no change to the cone path. Honour that — dispatch
*before* the existing logic, and leave the cone branch byte-identical.

`CLAP_FIRE_EVENT` deserves a real ROS2 topic with a proper timestamp, not a
log line. It is one of the clapboard's four core functions and the whole
reason the device is time-synced.

---

## 7. Work item 5 — `SetSlate` action + server (medium)

**Where:** `ros_ws/src/jugglebot_interfaces/action/SetSlate.action`, plus a
node (or an addition to an existing one).

### Why an action and not a service

The response time is dominated by the e-paper, not the wire: a full refresh is
1.5–3.5 s against ~5 ms of CAN traffic. A service call would block a caller
for seconds with no progress information. The action's result must not fire
until `CLAP_ACK` arrives carrying the measured `render_ms`.

### Suggested interface

```
# Goal
uint8 template_id
string[8] fields        # empty string = leave unchanged (patch semantics)
bool force_full_refresh
---
# Result
bool success
uint8 outcome           # mirrors CLAP_ACK outcome enum, protocol.md §8.6
uint16 render_ms
---
# Feedback
string stage            # "sending" | "awaiting_ack" | "rendering"
```

### Responsibilities that live here and nowhere else

1. **Chunking** — split each field into 7-byte `CLAP_FIELD` payloads.
2. **CRC** — CRC-16/CCITT-FALSE over the concatenated **32-byte NUL-padded**
   field buffers, ascending field id. Padding to a fixed width (rather than
   hashing trimmed strings) is what makes the CRC independent of chunk
   arrival order. Reuse the existing UDP-protocol CRC implementation; it is
   the same variant.
3. **`txn_id` allocation** and correlating the returned `CLAP_ACK`.
4. **Timeout** — if no ack within ~8 s, abort the goal.

   **The clapboard's ack semantics changed what "retry" means here**, so read
   §8.4 before implementing this:

   - The ack is emitted **when the commit is validated, not when the panel
     has painted**. `render_ms` is the *previous* render's duration. So an
     ack arriving in 5 ms is normal and does not mean the slate is up yet.
   - A retry with the **same `txn_id`** is safe and correct. The device
     detects the replay, re-acks with the stored outcome, and does not
     re-render. This is what makes a lost ack recoverable — so *do* retry
     once on timeout, contrary to the earlier advice here.
   - A retry landing while a render is in flight returns `BUSY`. That is
     transient and not recorded, so retrying again with the same `txn_id`
     succeeds. Do not treat `BUSY` as a terminal failure.
   - **Never reuse a `txn_id` for different content.** Replay detection is
     keyed on it alone; a recycled id with new fields is silently swallowed
     as a duplicate and the panel never updates.
5. **Validation** — reject field ids > 7 and strings > 32 chars at the action
   boundary with a clear message, rather than letting the clapboard reject
   them after a bus round-trip.

### Date autofill

The clapboard fills the date itself from its time-sync wall clock. Do not
send it as a field — you would be racing your own clock against the one the
bridge is already distributing.

---

## 8. Test obligations

Mirror the Jugglebot repo's own conventions — the (date, command, result)
triple, `run_tests.sh` as the gate, a logbook entry with a `Logbook-Entry:`
trailer.

| # | Test | Where |
|---|---|---|
| 1 | CRC of a known field set matches the clapboard's native test vector | `tests/` — cross-repo golden value, coordinate it |
| 2 | Chunking round-trips: 8 fields × 32 chars → 41 frames → reassembled identically | pure Python, no hardware |
| 3 | `CLAP_LINK` emitter flips within 500 ms of `LINK_LOST` | `tests/firmware/native/` |
| 4 | `cone_health` reports clapboard-present, not cone-present, when only clapboard IDs arrive | `tests/firmware/native/` |
| 5 | Cone path byte-identical after the `CONE_FRAME` dispatch change | existing cone tests must pass unmodified |
| 6 | Action aborts cleanly on ack timeout | `tests/ros/` |
| 7 | Bench: full path from `ros2 action send_goal` to a painted panel | hardware, logbook entry |

Test 5 is the regression guard that matters most — you are modifying a live
relay path that the catching-cone tooling depends on.

---

## 9. Suggested order

1. **§5 `cone_health`** — smallest, independent, and it makes every later
   bench observation trustworthy.
2. **§3 `CLAP_LINK`** — small, and it lets the clapboard team validate mode
   switching before any downlink exists.
3. **§6 Jetson handler** — unblocks observing the clapboard's heartbeat and
   fire events, which makes everything after this debuggable.
4. **§4 downlink RPC** — the big one, now with observability in place.
5. **§7 action server** — needs §4.

Steps 1–3 are all independently useful and independently testable. Do not
start §4 until you can see the clapboard's heartbeat on a ROS2 topic — you
will need it to debug the TX gate.

---

## 10. Open questions to raise with the user

- **Which node hosts the action server?** A new `clapboard_node.py`, or folded
  into an existing one? A new node is cleaner but adds a launch entry.
- **Should `CLAP_FIRE_EVENT` timestamps feed the existing logbook/analysis
  tooling**, or just a topic? They are genuinely useful for correlating
  recorded footage with robot telemetry.
- **Is the harness drop already wired**, or does the CAN3 connector need
  building? The clapboard side expects +12 V, GND, CANH, CANL and assumes
  it is one of the two 120 Ω termination points.
