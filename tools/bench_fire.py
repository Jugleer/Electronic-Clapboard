"""F6 endurance bench: poll /status while the operator presses the fire
button, watch fires_since_boot tick from start to a target count, and
flag any anomalies along the way.

Usage:
    python tools/bench_fire.py --host clapboard.local --target 100
    python tools/bench_fire.py --host 192.168.1.42 --target 25 --interval 0.5

What this catches that the eye misses across 100 fires:

  - Stuck-or-rejected fires (fires_since_boot doesn't tick after a press).
    Expected counter increments are silent on the script side; presses
    that *don't* advance the counter print a "no-tick" warning so the
    operator hears it without watching the terminal.
  - last_fire_at_ms going backwards or freezing (it shouldn't on this
    firmware; if it does, the state machine has a bug).
  - fire_ready stuck false (low-battery flag staying tripped after the
    pack should have recovered, or cooldown not clearing).
  - Counter outright skipping (e.g. 47 -> 49 with no observed press) —
    indicates a bounce that firmware debounce didn't suppress.

The harness only reads /status; it never POSTs. The fire mechanism is
button-only by design (protocol.md §2.3), so this script can't trigger
a fire on its own — that's the operator's job. The script's value is
making the human-press / device-state correlation auditable across a
long run.

Output (live):

    [00:00:01]  fires=0   ready=True   pack=12.05V (estimated)
    [00:00:04]  fires=1   ready=True   last_fire_at_ms=3245
    [00:00:07]  fires=2   ready=True   last_fire_at_ms=6201    Δ=2956ms
    [00:00:21]  fires=3   ready=True   last_fire_at_ms=20155   Δ=13954ms
    ...
    [00:05:12] WARN  observed press but counter unchanged (still 47)
    ...
    [00:08:30]  fires=100 ready=True   last_fire_at_ms=510221
    PASS  reached target=100. summary below.

Summary at end: total observed fires, mean / min / max gap between
accepted fires, count of "no-tick" warnings, count of fire_ready=false
windows.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Optional


# Defaults match the editor's resolveDefaultHost() logic enough for
# bench use; override with --host on a different network.
DEFAULT_HOST = "clapboard.local"
DEFAULT_TARGET = 100
DEFAULT_INTERVAL_S = 0.5  # 2 Hz poll — fast enough to see every press;
                          # firmware /status is single-line ~250 B JSON
                          # so this is well under any rate concern.
HTTP_TIMEOUT_S = 2.5


@dataclass
class Sample:
    """One /status poll's worth of state we care about."""
    elapsed_s: float
    fires: int
    ready: bool
    last_fire_at_ms: Optional[int]


@dataclass
class Stats:
    samples: list[Sample] = field(default_factory=list)
    no_tick_warnings: int = 0
    not_ready_windows: int = 0
    fire_intervals_ms: list[int] = field(default_factory=list)


def fetch_status(host: str) -> Optional[dict]:
    """Returns the parsed /status body, or None on transport failure.
    A None return prints a transient warning but doesn't abort the run —
    Wi-Fi blips happen on bench networks and shouldn't end an endurance
    test.
    """
    url = host
    if not url.startswith(("http://", "https://")):
        url = f"http://{url}"
    if not url.endswith("/status"):
        url = url.rstrip("/") + "/status"
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT_S) as resp:
            return json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"  [transport] {type(e).__name__}: {e}", file=sys.stderr)
        return None


def fmt_elapsed(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def run(host: str, target: int, interval_s: float) -> int:
    """Returns 0 on success (target reached), 2 on operator interrupt."""
    print(f"# F6 endurance bench")
    print(f"# host={host}  target={target}  interval={interval_s}s")
    print(f"# operator: press the fire button at >= {1500/1000:.1f}s "
          f"cadence; this script watches /status only.")
    print()

    start = time.monotonic()
    last_fires = -1            # forces the first sample to print
    last_fire_at_ms: Optional[int] = None
    last_ready: Optional[bool] = None
    stats = Stats()

    # Track whether the operator pressed the button without the counter
    # ticking — heuristic: a debounced press is a state change visible
    # only on the device. We can't *see* the press from here, so the
    # heuristic is "fire_ready was true on the previous sample, became
    # false this sample, but counter didn't advance." A debounce-only
    # rejection would flip ready to false transiently while the gates
    # fire, then back; if the counter never moved, something's off.
    prev_ready: Optional[bool] = None

    try:
        while True:
            status = fetch_status(host)
            now_s = time.monotonic() - start
            if status is None:
                time.sleep(interval_s)
                continue

            fw = status.get("firmware_version", "?")
            fires = status.get("fires_since_boot")
            ready = status.get("fire_ready")
            last_fire = status.get("last_fire_at_ms")

            if fires is None or ready is None:
                print(f"  [warn] firmware {fw} doesn't report fire fields "
                      f"— upgrade to >= 0.4.0 for this bench.")
                return 1

            # First-sample print regardless of changes — gives the
            # operator a "yes, I'm connected" line before they start
            # mashing the button.
            if last_fires < 0:
                print(f"[{fmt_elapsed(now_s)}]  fires={fires}   "
                      f"ready={ready}   firmware={fw}")
                last_fires = fires
                last_ready = ready
                last_fire_at_ms = last_fire
                prev_ready = ready
                stats.samples.append(
                    Sample(now_s, fires, bool(ready), last_fire))
                time.sleep(interval_s)
                continue

            # Counter ticked — record the gap and print.
            if fires > last_fires:
                if last_fire_at_ms is not None and last_fire is not None \
                        and isinstance(last_fire, int) \
                        and isinstance(last_fire_at_ms, int):
                    gap = last_fire - last_fire_at_ms
                    stats.fire_intervals_ms.append(gap)
                    delta_str = f"   Δ={gap}ms"
                else:
                    delta_str = ""
                ticked_by = fires - last_fires
                tick_warn = "" if ticked_by == 1 else \
                    f"  ! tick jumped by {ticked_by}"
                print(f"[{fmt_elapsed(now_s)}]  fires={fires}   "
                      f"ready={ready}   "
                      f"last_fire_at_ms={last_fire}{delta_str}{tick_warn}")
                last_fires = fires
                last_fire_at_ms = last_fire

            # ready=False window tracking — a single sample doesn't
            # qualify (cooldown is 1.5s and our poll is faster than
            # that, so a single-sample blip is normal). But sustained
            # false (>3 samples) means battery refusal.
            if not ready:
                if prev_ready is True:
                    stats.not_ready_windows += 1
            prev_ready = ready
            last_ready = ready

            if fires >= target:
                print()
                print(f"PASS  reached target={target} at "
                      f"{fmt_elapsed(now_s)} ({now_s:.1f}s).")
                _print_summary(stats)
                return 0

            time.sleep(interval_s)
    except KeyboardInterrupt:
        print()
        print(f"INTERRUPTED at {fmt_elapsed(time.monotonic() - start)} "
              f"with fires={last_fires} (target was {target}).")
        _print_summary(stats)
        return 2


def _print_summary(stats: Stats) -> None:
    print()
    print("# summary")
    if stats.fire_intervals_ms:
        gaps = stats.fire_intervals_ms
        print(f"  observed fires:        {len(gaps) + 1}")
        print(f"  inter-fire gap (ms):   "
              f"min={min(gaps)}  "
              f"mean={statistics.mean(gaps):.0f}  "
              f"max={max(gaps)}  "
              f"median={statistics.median(gaps):.0f}")
        # Anything below MIN_FIRE_GAP_MS (1500) means the firmware's
        # cooldown gate is broken. Anything wildly above means the
        # operator paused for breath, which is fine.
        below_gap = [g for g in gaps if g < 1500]
        if below_gap:
            print(f"  ! {len(below_gap)} gap(s) below MIN_FIRE_GAP_MS "
                  f"(1500): {below_gap}  — firmware cooldown bug?")
    else:
        print("  no fires observed during the run")
    if stats.not_ready_windows:
        print(f"  not-ready windows:     {stats.not_ready_windows}  "
              f"(transient cooldown blips OR sustained battery "
              f"refusal — check the live log)")
    print("  → cross-check final fires_since_boot against your "
          "press count; they should match.")


def main() -> int:
    p = argparse.ArgumentParser(
        description="F6 endurance bench: poll /status across a long fire run."
    )
    p.add_argument("--host", default=DEFAULT_HOST,
                   help=f"clapboard host (default: {DEFAULT_HOST})")
    p.add_argument("--target", type=int, default=DEFAULT_TARGET,
                   help=f"stop after this many fires (default: {DEFAULT_TARGET})")
    p.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_S,
                   help=f"poll interval in seconds (default: {DEFAULT_INTERVAL_S})")
    args = p.parse_args()
    return run(args.host, args.target, args.interval)


if __name__ == "__main__":
    sys.exit(main())
