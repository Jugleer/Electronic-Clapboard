import { describe, expect, it } from "vitest";

import { parseStatusBody } from "./useDeviceStatus";

// Phase 9: parser tolerates older firmwares that omit fire fields and
// older paths that returned a non-JSON body. Contract is locked in
// docs/protocol.md §2.2 "Fire fields" and §5 "Versioning" (clients
// must accept added fields without breaking).

describe("parseStatusBody", () => {
  it("parses a fresh-boot Phase 9 body — never fired, ready to fire", () => {
    const out = parseStatusBody({
      ok: true,
      firmware_version: "0.4.0",
      uptime_ms: 1234,
      free_heap: 100000,
      psram_free: 8000000,
      last_frame_at: null,
      last_frame_bytes: null,
      last_frame_render_ms: null,
      last_full_refresh: null,
      last_fire_at_ms: null,
      fires_since_boot: 0,
      fire_ready: true,
    });
    expect(out.firmwareVersion).toBe("0.4.0");
    expect(out.lastFireAtMs).toBeNull();
    expect(out.firesSinceBoot).toBe(0);
    expect(out.fireReady).toBe(true);
  });

  it("parses an after-fire body with last_fire_at_ms populated", () => {
    const out = parseStatusBody({
      firmware_version: "0.4.0",
      last_fire_at_ms: 7654,
      fires_since_boot: 3,
      fire_ready: false,
    });
    expect(out.lastFireAtMs).toBe(7654);
    expect(out.firesSinceBoot).toBe(3);
    expect(out.fireReady).toBe(false);
  });

  it("leaves fire fields undefined for pre-Phase-9 firmware (key absent)", () => {
    // A 0.3.0 firmware emits the original status fields and nothing
    // about fire. Distinguishable from "field present, value null"
    // by checking `'last_fire_at_ms' in body` — we want undefined,
    // not null, here so DeviceStatusBadge can hide the fire badge.
    const out = parseStatusBody({
      firmware_version: "0.3.0",
      uptime_ms: 1234,
      free_heap: 100000,
      psram_free: 8000000,
    });
    expect(out.firmwareVersion).toBe("0.3.0");
    expect(out.lastFireAtMs).toBeUndefined();
    expect(out.firesSinceBoot).toBeUndefined();
    expect(out.fireReady).toBeUndefined();
  });

  it("preserves null vs undefined distinction for last_fire_at_ms", () => {
    // Phase 9 firmware that emits the field as null: client sees null
    // (key present, no fire yet).
    const a = parseStatusBody({
      firmware_version: "0.4.0",
      last_fire_at_ms: null,
      fires_since_boot: 0,
      fire_ready: true,
    });
    expect(a.lastFireAtMs).toBeNull();
    // Pre-Phase-9 firmware: undefined (key absent, fire path unknown).
    const b = parseStatusBody({ firmware_version: "0.3.0" });
    expect(b.lastFireAtMs).toBeUndefined();
  });

  it("ignores garbage values without throwing", () => {
    // Defensive: if the firmware ships a typo'd type for a field we
    // care about, the parser must not throw — we want the rest of the
    // editor to keep working. The affected field falls back to
    // undefined; consumers treat that as "unsupported".
    const out = parseStatusBody({
      firmware_version: 123,
      last_fire_at_ms: "nope",
      fires_since_boot: "many",
      fire_ready: 1,
    });
    expect(out.firmwareVersion).toBeUndefined();
    expect(out.lastFireAtMs).toBeUndefined();
    expect(out.firesSinceBoot).toBeUndefined();
    expect(out.fireReady).toBeUndefined();
  });

  it("handles non-object inputs (null, array, string)", () => {
    expect(parseStatusBody(null)).toEqual({});
    expect(parseStatusBody(undefined)).toEqual({});
    expect(parseStatusBody("not json")).toEqual({});
    // Arrays are typeof "object" — must still produce {}, since
    // Record-like access on an array would surface the wrong shape.
    // The current implementation reads keys that won't exist on
    // arrays, which yields the same {} result.
    expect(parseStatusBody([])).toEqual({});
  });
});
