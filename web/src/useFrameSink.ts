/**
 * Thin React shell around sendFrame() and packFrame(). Exposes
 * `{ status, error, lastResult, send }` for the App to drive a single
 * "Send" button. Phase 3 only needs three states; Phase 4+ may grow this
 * if upload progress becomes a UX requirement (see Phase 3 notes).
 */

import { useCallback, useRef, useState } from "react";

import { packFrame } from "./packFrame";
import { sendFrame, type SendOk, type SendResult } from "./sendFrame";

export type FrameSinkStatus = "idle" | "sending" | "done" | "error";

export interface FrameSinkError {
  code: string;
  message: string;
  httpStatus?: number;
}

export interface UseFrameSinkResult {
  status: FrameSinkStatus;
  error: FrameSinkError | null;
  lastResult: SendOk | null;
  send: (canvas: HTMLCanvasElement, opts?: SendOpts) => Promise<void>;
}

export interface SendOpts {
  full?: boolean;
}

interface UseFrameSinkOptions {
  host: string;
}

export function useFrameSink({ host }: UseFrameSinkOptions): UseFrameSinkResult {
  const [status, setStatus] = useState<FrameSinkStatus>("idle");
  const [error, setError] = useState<FrameSinkError | null>(null);
  const [lastResult, setLastResult] = useState<SendOk | null>(null);
  const inFlight = useRef(false);

  const send = useCallback(
    async (canvas: HTMLCanvasElement, opts: SendOpts = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("sending");
      setError(null);

      let result: SendResult;
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setError({
            code: "no_context",
            message: "could not get 2D canvas context",
          });
          setStatus("error");
          return;
        }
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const bytes = packFrame(imageData);
        result = await sendFrame(bytes, { host, full: opts.full });
      } catch (err) {
        setError({
          code: "client_error",
          message: err instanceof Error ? err.message : String(err),
        });
        setStatus("error");
        return;
      } finally {
        inFlight.current = false;
      }

      if (result.ok) {
        setLastResult(result);
        setStatus("done");
      } else {
        setError({
          code: result.code,
          message: result.error,
          httpStatus: result.httpStatus,
        });
        setStatus("error");
      }
    },
    [host],
  );

  return { status, error, lastResult, send };
}
