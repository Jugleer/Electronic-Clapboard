import { describe, expect, it, vi } from "vitest";

import { FRAME_BYTES } from "./frameFormat";
import { sendFrame } from "./sendFrame";

function okResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function errResponse(status: number, code: string, error = code): Response {
  return new Response(
    JSON.stringify({ ok: false, error, code }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function dummyBytes(): Uint8Array {
  return new Uint8Array(FRAME_BYTES);
}

const sleep = vi.fn(async () => {});

describe("sendFrame happy path", () => {
  it("POSTs raw octet-stream bytes to <host>/frame and parses 200", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      okResponse({
        ok: true,
        bytes: 48000,
        render_ms: 1432,
        full_refresh: false,
      }),
    );

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
    });

    expect(result).toEqual({
      ok: true,
      bytes: 48000,
      render_ms: 1432,
      full_refresh: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe("http://clapboard.local/frame");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect((init.body as Uint8Array).length).toBe(FRAME_BYTES);
  });

  it("appends ?full=1 when full=true", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      okResponse({ ok: true, bytes: 48000, render_ms: 4000, full_refresh: true }),
    );
    await sendFrame(dummyBytes(), {
      host: "192.168.1.42",
      full: true,
      fetchImpl,
      sleep,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://192.168.1.42/frame?full=1");
  });
});

describe("sendFrame 503 backoff (busy)", () => {
  it("retries once at 500 ms after a 503, returns 200 second time", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errResponse(503, "busy"))
      .mockResolvedValueOnce(
        okResponse({
          ok: true,
          bytes: 48000,
          render_ms: 1500,
          full_refresh: false,
        }),
      );
    const slept: number[] = [];
    const recordSleep = vi.fn(async (ms: number) => {
      slept.push(ms);
    });

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep: recordSleep,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([500]);
  });

  it("retries 500 ms then 1000 ms after two 503s, returns 200 third time", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errResponse(503, "busy"))
      .mockResolvedValueOnce(errResponse(503, "busy"))
      .mockResolvedValueOnce(
        okResponse({
          ok: true,
          bytes: 48000,
          render_ms: 1500,
          full_refresh: false,
        }),
      );
    const slept: number[] = [];
    const recordSleep = vi.fn(async (ms: number) => {
      slept.push(ms);
    });

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep: recordSleep,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([500, 1000]);
  });

  it("gives up after 3 busy responses with code=busy", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(503, "busy"));

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("busy");
      expect(result.httpStatus).toBe(503);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("sendFrame 4xx (no retry)", () => {
  it.each([
    [400, "bad_size"],
    [413, "too_large"],
    [415, "bad_content_type"],
  ])("does NOT retry on %s / %s", async (status, code) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(status, code));

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.httpStatus).toBe(status);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("sendFrame 5xx (other than 503)", () => {
  it("retries once on 500 then surfaces error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(500, "internal"));

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.httpStatus).toBe(500);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("sendFrame network errors", () => {
  it("retries once on TypeError, returns 200 second time", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(
        okResponse({
          ok: true,
          bytes: 48000,
          render_ms: 1500,
          full_refresh: false,
        }),
      );

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("after two network errors, surfaces code=network", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network down"));

    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("sendFrame timeout", () => {
  it("aborts at the 10 s client deadline and surfaces code=timeout (no retry)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      // Wait until the AbortController fires, then mimic fetch's behaviour:
      // a DOMException-shaped error with name 'AbortError'.
      const signal = (init as RequestInit | undefined)?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (!signal) return; // shouldn't happen
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    // Inject a fake timeout that fires immediately so the test stays fast.
    const result = await sendFrame(dummyBytes(), {
      host: "clapboard.local",
      fetchImpl,
      sleep,
      timeoutMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
