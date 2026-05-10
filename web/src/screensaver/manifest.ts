/**
 * Typed wrappers for /screensaver/* endpoints (protocol.md §2.6).
 *
 * Mirrors sendFrame.ts discipline:
 *   - 503 (busy):  back off 500 ms then 1 s, give up after the third try.
 *   - other 5xx:   retry once.
 *   - network:     retry once.
 *   - 4xx:         never retry.
 *   - timeout:     no retry; per §4 the timeout budget already accommodates
 *                  the worst-case panel paint or LittleFS write.
 *
 * Every wrapper returns a tagged result. Errors carry the firmware's
 * machine-readable `code` slug (`bad_slot`, `bad_name`, `bad_size`,
 * `slot_empty`, `bad_config`, etc.) plus synthetic slugs for client-side
 * conditions (`network`, `timeout`, `bad_response`).
 */

import { FRAME_BYTES } from "../frameFormat";

// --- Public types -----------------------------------------------------------

export type PickerMode = "round_robin" | "wallclock_hybrid";

export interface SlotInfo {
  slot: number;
  name: string;
  bytes: number;
  updated_at_ms: number;
}

export interface Manifest {
  ok: true;
  enabled: boolean;
  cycle_interval_s: number;
  min_cycle_interval_s: number;
  max_cycle_interval_s: number;
  max_slots: number;
  picker_mode: PickerMode;
  picker_mode_actual: PickerMode;
  rtc_synced: boolean;
  current_slot: number | null;
  last_tick_ms: number | null;
  next_tick_ms: number | null;
  slots: SlotInfo[];
}

export interface ApiErr {
  ok: false;
  code: string;
  error: string;
  httpStatus?: number;
}

export type Result<T> = (T & { ok: true }) | ApiErr;

export interface ApiOptions {
  host: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// --- Timeouts (protocol.md §4) ---------------------------------------------

const TIMEOUT_GET_MANIFEST_MS  = 3_000;
const TIMEOUT_PUSH_FRAME_MS    = 10_000;
const TIMEOUT_DELETE_FRAME_MS  = 3_000;
const TIMEOUT_RENAME_MS        = 3_000;
const TIMEOUT_CONFIG_MS        = 3_000;

const BUSY_BACKOFF_MS = [500, 1000];

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- Endpoint wrappers ------------------------------------------------------

export async function getManifest(opts: ApiOptions): Promise<Result<Manifest>> {
  const url = buildUrl(opts.host, "/screensaver/manifest");
  return runWithRetry(
    () => attempt(url, { method: "GET" }, opts.timeoutMs ?? TIMEOUT_GET_MANIFEST_MS,
                  opts.fetchImpl ?? fetch, isManifest),
    opts.sleep ?? defaultSleep,
  );
}

export async function pushSlate(
  bytes: Uint8Array,
  args: { slot: number; name?: string },
  opts: ApiOptions,
): Promise<Result<{ slot: number; bytes: number; name: string | null }>> {
  if (bytes.length !== FRAME_BYTES) {
    return clientErr("bad_size",
      `expected ${FRAME_BYTES} bytes, got ${bytes.length}`);
  }
  if (!isValidSlot(args.slot)) {
    return clientErr("bad_slot", `slot must be 0..49, got ${args.slot}`);
  }
  if (args.name !== undefined && !isValidName(args.name)) {
    return clientErr("bad_name", "name must be 1..32 chars");
  }

  const qs = new URLSearchParams();
  qs.set("slot", String(args.slot));
  if (args.name !== undefined) qs.set("name", args.name);
  const url = buildUrl(opts.host, `/screensaver/frame?${qs.toString()}`);

  return runWithRetry(
    () => attempt(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    }, opts.timeoutMs ?? TIMEOUT_PUSH_FRAME_MS, opts.fetchImpl ?? fetch,
    isPushSlateOk),
    opts.sleep ?? defaultSleep,
  );
}

export async function renameSlate(
  args: { slot: number; name: string },
  opts: ApiOptions,
): Promise<Result<{ slot: number; name: string }>> {
  if (!isValidSlot(args.slot)) {
    return clientErr("bad_slot", `slot must be 0..49, got ${args.slot}`);
  }
  if (!isValidName(args.name)) {
    return clientErr("bad_name", "name must be 1..32 chars");
  }
  const qs = new URLSearchParams();
  qs.set("slot", String(args.slot));
  qs.set("name", args.name);
  const url = buildUrl(opts.host, `/screensaver/rename?${qs.toString()}`);

  return runWithRetry(
    () => attempt(url, { method: "POST" },
                  opts.timeoutMs ?? TIMEOUT_RENAME_MS,
                  opts.fetchImpl ?? fetch, isRenameOk),
    opts.sleep ?? defaultSleep,
  );
}

export async function deleteSlate(
  args: { slot: number },
  opts: ApiOptions,
): Promise<Result<{ slot: number; remaining: number }>> {
  if (!isValidSlot(args.slot)) {
    return clientErr("bad_slot", `slot must be 0..49, got ${args.slot}`);
  }
  const qs = new URLSearchParams();
  qs.set("slot", String(args.slot));
  const url = buildUrl(opts.host, `/screensaver/frame?${qs.toString()}`);

  return runWithRetry(
    () => attempt(url, { method: "DELETE" },
                  opts.timeoutMs ?? TIMEOUT_DELETE_FRAME_MS,
                  opts.fetchImpl ?? fetch, isDeleteOk),
    opts.sleep ?? defaultSleep,
  );
}

export interface ConfigPatch {
  enabled?: boolean;
  cycle_interval_s?: number;
  picker_mode?: PickerMode;
}

export async function setConfig(
  patch: ConfigPatch,
  opts: ApiOptions,
): Promise<Result<Manifest>> {
  const url = buildUrl(opts.host, "/screensaver/config");
  const body = JSON.stringify(patch);
  return runWithRetry(
    () => attempt(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }, opts.timeoutMs ?? TIMEOUT_CONFIG_MS, opts.fetchImpl ?? fetch, isManifest),
    opts.sleep ?? defaultSleep,
  );
}

// --- Internals --------------------------------------------------------------

function buildUrl(host: string, path: string): string {
  const base = host.startsWith("http://") || host.startsWith("https://")
    ? host
    : `http://${host}`;
  return `${base.replace(/\/+$/, "")}${path}`;
}

function isValidSlot(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 49;
}

function isValidName(s: string): boolean {
  // 1..32 chars; protocol.md §2.6 doesn't constrain the alphabet, only
  // the URL-encoded length on the wire.
  return s.length >= 1 && s.length <= 32;
}

function clientErr(code: string, error: string): ApiErr {
  return { ok: false, code, error };
}

type AttemptResult<T> =
  | { kind: "ok"; value: T & { ok: true } }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "network"; message: string };

async function attempt<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  isOkBody: (b: unknown) => b is T & { ok: true },
): Promise<AttemptResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted ||
        (err as Error)?.name === "AbortError") {
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
    // non-JSON response; we synthesise an error below
  }

  if (response.ok) {
    if (isOkBody(body)) {
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

async function runWithRetry<T>(
  doAttempt: () => Promise<AttemptResult<T>>,
  sleep: (ms: number) => Promise<void>,
): Promise<Result<T>> {
  let busyAttempt = 0;
  let networkRetried = false;
  let serverRetried = false;

  for (;;) {
    const r = await doAttempt();

    if (r.kind === "ok") return r.value;

    if (r.kind === "http") {
      const { status, body } = r;
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
      if (!serverRetried) {
        serverRetried = true;
        continue;
      }
      return errFromBody(status, body, "internal");
    }

    if (r.kind === "timeout") {
      return { ok: false, code: "timeout", error: "request timed out" };
    }

    if (!networkRetried) {
      networkRetried = true;
      continue;
    }
    return { ok: false, code: "network", error: r.message };
  }
}

function errFromBody(
  status: number,
  body: unknown,
  fallbackCode = "internal",
): ApiErr {
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

// --- Body shape predicates --------------------------------------------------

function isManifest(b: unknown): b is Manifest {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    o.ok === true &&
    typeof o.enabled === "boolean" &&
    typeof o.cycle_interval_s === "number" &&
    typeof o.min_cycle_interval_s === "number" &&
    typeof o.max_cycle_interval_s === "number" &&
    typeof o.max_slots === "number" &&
    typeof o.picker_mode === "string" &&
    typeof o.picker_mode_actual === "string" &&
    typeof o.rtc_synced === "boolean" &&
    (o.current_slot === null || typeof o.current_slot === "number") &&
    (o.last_tick_ms === null || typeof o.last_tick_ms === "number") &&
    (o.next_tick_ms === null || typeof o.next_tick_ms === "number") &&
    Array.isArray(o.slots)
  );
}

function isPushSlateOk(b: unknown):
  b is { ok: true; slot: number; bytes: number; name: string | null } {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    o.ok === true &&
    typeof o.slot === "number" &&
    typeof o.bytes === "number" &&
    (o.name === null || typeof o.name === "string")
  );
}

function isRenameOk(b: unknown): b is { ok: true; slot: number; name: string } {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    o.ok === true &&
    typeof o.slot === "number" &&
    typeof o.name === "string"
  );
}

function isDeleteOk(b: unknown):
  b is { ok: true; slot: number; remaining: number } {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    o.ok === true &&
    typeof o.slot === "number" &&
    typeof o.remaining === "number"
  );
}
