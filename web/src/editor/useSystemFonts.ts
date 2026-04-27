/**
 * System-font enumeration via the Local Font Access API
 * (`window.queryLocalFonts()`). Available in Chromium-based browsers
 * after a user-permission prompt; absent in Firefox and Safari.
 *
 * The hook starts in a "not requested" state. Calling `request()`
 * triggers the browser's permission dialog; on grant we cache the
 * de-duplicated family list. If the API is missing we return
 * `supported: false` and the UI falls back to a free-text input —
 * any font name typed there still works at render time as long as
 * Windows resolves it (canvas + browser share the same font stack).
 */

import { useCallback, useEffect, useState } from "react";

interface QueriedFont {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
}

interface LocalFontAccessWindow extends Window {
  queryLocalFonts?: () => Promise<QueriedFont[]>;
}

export type FontEnumerationStatus = "idle" | "loading" | "ready" | "denied" | "unsupported";

export interface UseSystemFontsResult {
  supported: boolean;
  status: FontEnumerationStatus;
  families: string[];
  request: () => Promise<void>;
}

export function useSystemFonts(): UseSystemFontsResult {
  const [status, setStatus] = useState<FontEnumerationStatus>("idle");
  const [families, setFamilies] = useState<string[]>([]);

  const supported =
    typeof window !== "undefined" &&
    typeof (window as LocalFontAccessWindow).queryLocalFonts === "function";

  useEffect(() => {
    if (!supported) setStatus("unsupported");
  }, [supported]);

  const request = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    try {
      const fonts = await (window as LocalFontAccessWindow).queryLocalFonts!();
      const uniq = Array.from(new Set(fonts.map((f) => f.family)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setFamilies(uniq);
      setStatus("ready");
    } catch {
      setStatus("denied");
    }
  }, [supported]);

  return { supported, status, families, request };
}
