/**
 * Periodic /status poll. Lets the editor surface a clean awake/asleep
 * indicator instead of waiting for the next manual /frame send to fail.
 *
 * Polling cadence:
 *   - Active (last poll succeeded):     POLL_AWAKE_MS
 *   - Failed once (state still awake):  immediate fast retry
 *   - Failed twice (asleep / off):      POLL_ASLEEP_MS — slower so we
 *     don't churn the laptop's network stack when the device is gone
 *
 * The hook never throws — every error is folded into the returned
 * `state` so consumers render purely from props.
 *
 * Phase 9: parses fire telemetry (last_fire_at_ms, fires_since_boot,
 * fire_ready) from the response body. Older firmwares (< 0.4.0) won't
 * emit these fields; the parser leaves the corresponding info fields
 * undefined so consumers can hide the fire badge cleanly.
 */

import { useEffect, useRef, useState } from "react";

export type DeviceState =
  | "unknown" // first poll hasn't returned yet
  | "awake" // /status responded 2xx
  | "asleep" // /status timed out / network-failed (most likely deep-sleep)
  | "error"; // /status responded but with garbage / non-2xx

export interface DeviceStatusInfo {
  state: DeviceState;
  /** Local Date.now() of the last successful poll, null if never. */
  lastSeen: number | null;
  /** Free-form detail when state === "error". */
  detail?: string;
  /** Reported firmware version, e.g. "0.4.0". Undefined on pre-Phase-1
   *  firmwares or when the body wasn't parseable. */
  firmwareVersion?: string;
  /** millis() at last accepted fire, or null if none this awake session.
   *  Undefined on firmwares predating Phase 9 (< 0.4.0). */
  lastFireAtMs?: number | null;
  /** Monotonic count of accepted fires this awake session. Undefined on
   *  firmwares predating Phase 9. */
  firesSinceBoot?: number;
  /** True when a press right now would be accepted. False during
   *  cooldown OR when battery is below threshold. Undefined on firmwares
   *  predating Phase 9. */
  fireReady?: boolean;
}

/** Internal: parses the /status JSON body, tolerating older firmwares
 *  that omit the Phase 9 fire fields. Returns only the fields we
 *  consume; the response carries more we don't surface (free_heap,
 *  psram_free, last_frame_*) and they're ignored here. */
export function parseStatusBody(body: unknown): {
  firmwareVersion?: string;
  lastFireAtMs?: number | null;
  firesSinceBoot?: number;
  fireReady?: boolean;
} {
  if (body === null || typeof body !== "object") return {};
  const o = body as Record<string, unknown>;
  const out: ReturnType<typeof parseStatusBody> = {};
  if (typeof o.firmware_version === "string") {
    out.firmwareVersion = o.firmware_version;
  }
  // last_fire_at_ms: number | null — only set the field if present, so
  // pre-Phase-9 firmwares (where the key is absent) can be distinguished
  // from "fire field present, value null".
  if ("last_fire_at_ms" in o) {
    const v = o.last_fire_at_ms;
    if (v === null) out.lastFireAtMs = null;
    else if (typeof v === "number") out.lastFireAtMs = v;
  }
  if (typeof o.fires_since_boot === "number") {
    out.firesSinceBoot = o.fires_since_boot;
  }
  if (typeof o.fire_ready === "boolean") {
    out.fireReady = o.fire_ready;
  }
  return out;
}

export const POLL_AWAKE_MS = 8_000;
export const POLL_ASLEEP_MS = 4_000;
export const STATUS_TIMEOUT_MS = 2_500;

interface Options {
  host: string;
  /** Test-only: inject a fetch and clock. */
  fetchImpl?: typeof fetch;
}

export function useDeviceStatus({
  host,
  fetchImpl,
}: Options): DeviceStatusInfo {
  const [info, setInfo] = useState<DeviceStatusInfo>({
    state: "unknown",
    lastSeen: null,
  });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const fetchFn = fetchImpl ?? fetch;
    let timer: number | undefined;

    const url = buildStatusUrl(host);

    const schedule = (delayMs: number, run: () => void) => {
      timer = window.setTimeout(run, delayMs);
    };

    const tick = async () => {
      if (cancelledRef.current) return;
      const controller = new AbortController();
      const abortTimer = window.setTimeout(
        () => controller.abort(),
        STATUS_TIMEOUT_MS,
      );
      try {
        const res = await fetchFn(url, { signal: controller.signal });
        if (cancelledRef.current) return;
        if (!res.ok) {
          setInfo((prev) => ({
            state: "error",
            lastSeen: prev.lastSeen,
            detail: `HTTP ${res.status}`,
          }));
          schedule(POLL_AWAKE_MS, tick);
          return;
        }
        // Phase 9: parse the body to read fire telemetry. A non-JSON
        // body or older firmware that omits fields just leaves them
        // undefined — we never let parsing failure flip "awake" to
        // "error", so the proof-of-life signal is still purely the
        // 2xx status.
        let parsed: ReturnType<typeof parseStatusBody> = {};
        try {
          const body = await res.json();
          parsed = parseStatusBody(body);
        } catch {
          // ignore — older firmwares might respond with text/plain or
          // a malformed body during a partial AsyncTCP write.
        }
        setInfo({
          state: "awake",
          lastSeen: Date.now(),
          firmwareVersion: parsed.firmwareVersion,
          lastFireAtMs: parsed.lastFireAtMs,
          firesSinceBoot: parsed.firesSinceBoot,
          fireReady: parsed.fireReady,
        });
        schedule(POLL_AWAKE_MS, tick);
      } catch (err) {
        if (cancelledRef.current) return;
        // AbortError or any network failure → device unreachable. We
        // can't distinguish "asleep" from "powered off" / "wrong
        // network" from outside, so the badge says "asleep" but the
        // hint copy in App.tsx covers all three.
        setInfo((prev) => ({
          state: "asleep",
          lastSeen: prev.lastSeen,
          detail: err instanceof Error ? err.message : String(err),
        }));
        schedule(POLL_ASLEEP_MS, tick);
      } finally {
        window.clearTimeout(abortTimer);
      }
    };

    // Kick off immediately on mount / host change.
    void tick();

    return () => {
      cancelledRef.current = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [host, fetchImpl]);

  return info;
}

function buildStatusUrl(host: string): string {
  const base =
    host.startsWith("http://") || host.startsWith("https://")
      ? host
      : `http://${host}`;
  return `${base.replace(/\/+$/, "")}/status`;
}
