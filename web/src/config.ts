/**
 * Target host resolution. mDNS on Windows without Bonjour is flaky (Phase 1
 * implementation note 1 in the plan), so the editor must let the user
 * override the firmware hostname or punch in a raw IP.
 *
 * Precedence:
 *   1. localStorage["clapboard.host"]  — set via the in-page input.
 *   2. import.meta.env.VITE_CLAPBOARD_HOST  — Vite build-time env override.
 *   3. "clapboard.local"                — happy-path mDNS default.
 */

export const DEFAULT_HOST = "clapboard.local";
const STORAGE_KEY = "clapboard.host";

export function resolveDefaultHost(): string {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim();
  }
  const envHost = import.meta.env.VITE_CLAPBOARD_HOST;
  if (typeof envHost === "string" && envHost.trim()) return envHost.trim();
  return DEFAULT_HOST;
}

export function persistHost(host: string): void {
  if (typeof localStorage === "undefined") return;
  const trimmed = host.trim();
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
