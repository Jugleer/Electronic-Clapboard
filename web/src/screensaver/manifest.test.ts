import { describe, expect, it, vi } from "vitest";

import { FRAME_BYTES } from "../frameFormat";
import {
  deleteSlate,
  getManifest,
  pushSlate,
  renameSlate,
  setConfig,
  type Manifest,
} from "./manifest";

const sleep = vi.fn(async () => {});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function errResponse(status: number, code: string, error = code): Response {
  return new Response(
    JSON.stringify({ ok: false, error, code }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function dummyBytes(): Uint8Array {
  return new Uint8Array(FRAME_BYTES);
}

const FRESH_MANIFEST: Manifest = {
  ok: true,
  enabled: false,
  cycle_interval_s: 300,
  min_cycle_interval_s: 60,
  max_cycle_interval_s: 604800,
  max_slots: 50,
  picker_mode: "round_robin",
  picker_mode_actual: "round_robin",
  rtc_synced: false,
  current_slot: null,
  last_tick_ms: null,
  next_tick_ms: null,
  slots: [],
};

// --- getManifest -----------------------------------------------------------

describe("getManifest", () => {
  it("GETs /screensaver/manifest and parses the body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(FRESH_MANIFEST));
    const result = await getManifest({ host: "clapboard.local", fetchImpl, sleep });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cycle_interval_s).toBe(300);
      expect(result.slots).toEqual([]);
    }
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toBe("http://clapboard.local/screensaver/manifest");
  });

  it("rejects malformed 200 with code=bad_response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true /* missing fields */ }));
    const result = await getManifest({ host: "x", fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bad_response");
  });

  it("retries once on network error then surfaces code=network", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValue(new TypeError("down"));
    const result = await getManifest({ host: "x", fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("network");
  });

  it("503 backs off then succeeds", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(errResponse(503, "busy"))
      .mockResolvedValueOnce(jsonResponse(FRESH_MANIFEST));
    const slept: number[] = [];
    const recordSleep = vi.fn(async (ms: number) => { slept.push(ms); });
    const result = await getManifest({ host: "x", fetchImpl, sleep: recordSleep });
    expect(result.ok).toBe(true);
    expect(slept).toEqual([500]);
  });
});

// --- pushSlate -------------------------------------------------------------

describe("pushSlate", () => {
  it("POSTs octet-stream body to /screensaver/frame?slot=N&name=...", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true, slot: 3, bytes: 48000, name: "studio-blue" }));
    const result = await pushSlate(
      dummyBytes(),
      { slot: 3, name: "studio-blue" },
      { host: "192.168.1.42", fetchImpl, sleep },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slot).toBe(3);
      expect(result.name).toBe("studio-blue");
    }
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "http://192.168.1.42/screensaver/frame?slot=3&name=studio-blue",
    );
    expect((init as RequestInit).method).toBe("POST");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect((init as RequestInit).body).toBeInstanceOf(Uint8Array);
  });

  it("URL-encodes slot names with spaces / special chars", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true, slot: 0, bytes: 48000, name: "studio blue!" }));
    await pushSlate(
      dummyBytes(),
      { slot: 0, name: "studio blue!" },
      { host: "x", fetchImpl, sleep },
    );
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("name=studio+blue%21");
  });

  it("omits ?name= when no name is provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true, slot: 7, bytes: 48000, name: null }));
    await pushSlate(dummyBytes(), { slot: 7 }, { host: "x", fetchImpl, sleep });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toBe("http://x/screensaver/frame?slot=7");
  });

  it("rejects bad byte count without hitting the network", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await pushSlate(
      new Uint8Array(100),
      { slot: 0 },
      { host: "x", fetchImpl, sleep },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bad_size");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects out-of-range slot without hitting the network", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const r1 = await pushSlate(dummyBytes(), { slot: -1 },
      { host: "x", fetchImpl, sleep });
    const r2 = await pushSlate(dummyBytes(), { slot: 50 },
      { host: "x", fetchImpl, sleep });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("bad_slot");
    if (!r2.ok) expect(r2.code).toBe("bad_slot");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects empty / overlong name without hitting the network", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const r1 = await pushSlate(dummyBytes(), { slot: 0, name: "" },
      { host: "x", fetchImpl, sleep });
    const r2 = await pushSlate(dummyBytes(),
      { slot: 0, name: "x".repeat(33) },
      { host: "x", fetchImpl, sleep });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("bad_name");
    if (!r2.ok) expect(r2.code).toBe("bad_name");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards firmware 4xx slug verbatim (e.g. bad_slot)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errResponse(400, "bad_slot"));
    const result = await pushSlate(
      dummyBytes(),
      { slot: 49 },
      { host: "x", fetchImpl, sleep },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("bad_slot");
      expect(result.httpStatus).toBe(400);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);  // no retry on 4xx
  });

  it("does NOT retry on 4xx (does not hammer the wire on bad_size)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errResponse(400, "bad_size"));
    const result = await pushSlate(dummyBytes(), { slot: 0 },
      { host: "x", fetchImpl, sleep });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("503 backs off 500/1000 ms then succeeds", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(errResponse(503, "busy"))
      .mockResolvedValueOnce(errResponse(503, "busy"))
      .mockResolvedValueOnce(jsonResponse(
        { ok: true, slot: 0, bytes: 48000, name: null }));
    const slept: number[] = [];
    const recordSleep = vi.fn(async (ms: number) => { slept.push(ms); });
    const result = await pushSlate(
      dummyBytes(), { slot: 0 },
      { host: "x", fetchImpl, sleep: recordSleep },
    );
    expect(result.ok).toBe(true);
    expect(slept).toEqual([500, 1000]);
  });

  it("gives up after 3 busy responses with code=busy", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(errResponse(503, "busy"));
    const result = await pushSlate(dummyBytes(), { slot: 0 },
      { host: "x", fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("busy");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries once on a network error then surfaces code=network", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"));
    const result = await pushSlate(dummyBytes(), { slot: 0 },
      { host: "x", fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("network");
  });
});

// --- renameSlate -----------------------------------------------------------

describe("renameSlate", () => {
  it("POSTs an empty body to /screensaver/rename", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true, slot: 5, name: "renamed" }));
    const result = await renameSlate(
      { slot: 5, name: "renamed" },
      { host: "x", fetchImpl, sleep },
    );
    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/screensaver/rename?slot=5&name=renamed");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("forwards 404 slot_empty when renaming an unoccupied slot", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errResponse(404, "slot_empty"));
    const result = await renameSlate(
      { slot: 9, name: "ghost" },
      { host: "x", fetchImpl, sleep },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("slot_empty");
      expect(result.httpStatus).toBe(404);
    }
  });

  it("rejects bad slot / name client-side", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const r1 = await renameSlate({ slot: 50, name: "x" },
      { host: "x", fetchImpl, sleep });
    const r2 = await renameSlate({ slot: 0, name: "" },
      { host: "x", fetchImpl, sleep });
    if (!r1.ok) expect(r1.code).toBe("bad_slot");
    if (!r2.ok) expect(r2.code).toBe("bad_name");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// --- deleteSlate -----------------------------------------------------------

describe("deleteSlate", () => {
  it("DELETEs /screensaver/frame?slot=N", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true, slot: 3, remaining: 4 }));
    const result = await deleteSlate({ slot: 3 },
      { host: "x", fetchImpl, sleep });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remaining).toBe(4);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/screensaver/frame?slot=3");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("forwards 404 slot_empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errResponse(404, "slot_empty"));
    const result = await deleteSlate({ slot: 9 },
      { host: "x", fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("slot_empty");
  });
});

// --- setConfig -------------------------------------------------------------

describe("setConfig", () => {
  it("POSTs JSON to /screensaver/config and returns the new manifest", async () => {
    const next = { ...FRESH_MANIFEST, enabled: true, cycle_interval_s: 120 };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(next));
    const result = await setConfig(
      { enabled: true, cycle_interval_s: 120 },
      { host: "x", fetchImpl, sleep },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cycle_interval_s).toBe(120);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/screensaver/config");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ enabled: true, cycle_interval_s: 120 }),
    );
  });

  it("forwards bad_config from a 400", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      errResponse(400, "bad_config"));
    const result = await setConfig({ cycle_interval_s: 1 },
      { host: "x", fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("bad_config");
      expect(result.httpStatus).toBe(400);
    }
  });

  it("retries once on a 500 then surfaces internal", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(errResponse(500, "internal"));
    const result = await setConfig({ enabled: true },
      { host: "x", fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("internal");
  });
});
