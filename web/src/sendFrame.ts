/**
 * POSTs a 48000-byte 1bpp frame to the firmware's `/frame` endpoint.
 *
 * Retry policy comes straight from docs/protocol.md §4:
 *   - 503 (busy):  back off 500 ms then 1 s, give up after the third try.
 *   - other 5xx:   retry once, then surface.
 *   - network:     retry once, then surface as `code: "network"`.
 *   - timeout:     no retry (10 s budget already accommodates render time).
 *   - 4xx:         never retry — the request itself is wrong.
 *
 * The function returns a tagged result rather than throwing, so the calling
 * hook can pattern-match on `result.ok` without wrapping everything in
 * try/catch. Errors carry the firmware's machine-readable `code` slug
 * (`bad_size`, `too_large`, `bad_content_type`, `busy`, `internal`) plus
 * synthetic slugs for client-side conditions (`network`, `timeout`,
 * `bad_response`).
 *
 * `fetchImpl` and `sleep` are injectable for testing; default to global
 * `fetch` and a `setTimeout`-based sleep.
 */

import { FRAME_BYTES } from "./frameFormat";

export interface SendFrameOptions {
  host: string;
  full?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface SendOk {
  ok: true;
  bytes: number;
  render_ms: number;
  full_refresh: boolean;
}

export interface SendErr {
  ok: false;
  code: string;
  error: string;
  httpStatus?: number;
}

export type SendResult = SendOk | SendErr;

const DEFAULT_TIMEOUT_MS = 10_000;
const BUSY_BACKOFF_MS = [500, 1000];

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendFrame(
  bytes: Uint8Array,
  opts: SendFrameOptions,
): Promise<SendResult> {
  if (bytes.length !== FRAME_BYTES) {
    return {
      ok: false,
      code: "bad_size",
      error: `expected ${FRAME_BYTES} bytes, got ${bytes.length}`,
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildUrl(opts.host, opts.full ?? false);

  let busyAttempt = 0; // 0, 1, 2 — back-off table indexes 0 and 1
  let networkRetried = false;
  let serverRetried = false;

  for (;;) {
    const attemptResult = await attempt(bytes, url, timeoutMs, fetchImpl);

    if (attemptResult.kind === "ok") {
      return attemptResult.value;
    }

    if (attemptResult.kind === "http") {
      const { status, body } = attemptResult;

      if (status === 503) {
        if (busyAttempt < BUSY_BACKOFF_MS.length) {
          await sleep(BUSY_BACKOFF_MS[busyAttempt]);
          busyAttempt++;
          continue;
        }
        return errFromBody(status, body, "busy");
      }

      if (status >= 400 && status < 500) {
        return errFromBody(status, body);
      }

      // Other 5xx: retry once.
      if (!serverRetried) {
        serverRetried = true;
        continue;
      }
      return errFromBody(status, body, "internal");
    }

    if (attemptResult.kind === "timeout") {
      return {
        ok: false,
        code: "timeout",
        error: `request exceeded ${timeoutMs} ms`,
      };
    }

    // network
    if (!networkRetried) {
      networkRetried = true;
      continue;
    }
    return {
      ok: false,
      code: "network",
      error: attemptResult.message,
    };
  }
}

function buildUrl(host: string, full: boolean): string {
  const base = host.startsWith("http://") || host.startsWith("https://")
    ? host
    : `http://${host}`;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/frame${full ? "?full=1" : ""}`;
}

type AttemptResult =
  | { kind: "ok"; value: SendOk }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "network"; message: string };

async function attempt(
  bytes: Uint8Array,
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted || (err as Error)?.name === "AbortError") {
      return { kind: "timeout" };
    }
    return {
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Fall through — server returned non-JSON; we'll synthesize an error.
  }

  if (response.ok) {
    if (isSendOkBody(body)) {
      return { kind: "ok", value: body };
    }
    return {
      kind: "http",
      status: response.status,
      body: { ok: false, code: "bad_response", error: "malformed 200 body" },
    };
  }

  return { kind: "http", status: response.status, body };
}

function isSendOkBody(b: unknown): b is SendOk {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    o.ok === true &&
    typeof o.bytes === "number" &&
    typeof o.render_ms === "number" &&
    typeof o.full_refresh === "boolean"
  );
}

function errFromBody(
  status: number,
  body: unknown,
  fallbackCode = "internal",
): SendErr {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (o.ok === false && typeof o.code === "string") {
      return {
        ok: false,
        code: o.code,
        error: typeof o.error === "string" ? o.error : o.code,
        httpStatus: status,
      };
    }
  }
  return {
    ok: false,
    code: fallbackCode,
    error: `HTTP ${status}`,
    httpStatus: status,
  };
}
