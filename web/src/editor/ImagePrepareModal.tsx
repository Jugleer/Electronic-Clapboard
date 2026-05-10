/**
 * Per-file image preparation modal. Sits between "user picked one or
 * more files" and the actual upload / element-add. For each picked
 * file it lets the user:
 *   - rename the slate / element (default = filename without
 *     extension, capped at the wire-side 32-char limit)
 *   - choose binarisation: Floyd-Steinberg (default) or
 *     threshold-only ("raw, no dither")
 *
 * Used by both upload paths so the choice is consistent:
 *   - Screensaver panel "+ Upload images" → goes to /screensaver/frame
 *   - Editor "+ Image" / "+ Background" / drag-drop → adds an
 *     ImageElement to the editor with the chosen algorithm baked in
 *     (the user can still fine-tune via PropertiesPanel afterwards)
 */

import { useEffect, useMemo, useState } from "react";

import type { Palette } from "./themeStore";
import type { DitherAlgorithm } from "./types";

const MAX_NAME_CHARS = 32;

export interface ImagePrepareDecision {
  file: File;
  /** Trimmed display name. Caller passes this to the wire (`?name=`)
   *  or the ImageElement's `id`. Always non-empty when emitted. */
  name: string;
  algorithm: DitherAlgorithm;
}

interface Props {
  files: File[];
  palette: Palette;
  onConfirm: (decisions: ImagePrepareDecision[]) => void;
  onCancel: () => void;
  /** Optional copy override for the primary button — useful when the
   *  caller wants "Add to canvas" instead of "Upload all". */
  confirmLabel?: string;
}

interface RowState {
  name: string;
  algorithm: DitherAlgorithm;
  previewUrl: string | null;
}

export function ImagePrepareModal({
  files,
  palette,
  onConfirm,
  onCancel,
  confirmLabel,
}: Props) {
  const [rows, setRows] = useState<RowState[]>(() =>
    files.map((f) => ({
      name: stemOf(f.name).slice(0, MAX_NAME_CHARS),
      algorithm: "fs" as DitherAlgorithm,
      previewUrl: tryCreateObjectURL(f),
    })),
  );

  // Re-derive when the file list changes (rare — the parent usually
  // mounts the modal with a single immutable batch). Revoke the old
  // object URLs before tearing the rows down to avoid leaking them.
  useEffect(() => {
    setRows((prev) => {
      // Revoke any prior URLs that won't carry forward.
      prev.forEach((r) => {
        if (r.previewUrl) tryRevokeObjectURL(r.previewUrl);
      });
      return files.map((f) => ({
        name: stemOf(f.name).slice(0, MAX_NAME_CHARS),
        algorithm: "fs" as DitherAlgorithm,
        previewUrl: tryCreateObjectURL(f),
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      rows.forEach((r) => {
        if (r.previewUrl) tryRevokeObjectURL(r.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allNamesNonEmpty = useMemo(
    () => rows.every((r) => r.name.trim().length > 0),
    [rows],
  );

  if (files.length === 0) return null;

  const updateRow = (i: number, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const onConfirmClick = () => {
    const decisions: ImagePrepareDecision[] = rows.map((r, i) => ({
      file: files[i],
      name: r.name.trim().slice(0, MAX_NAME_CHARS),
      algorithm: r.algorithm,
    }));
    onConfirm(decisions);
  };

  return (
    <div
      role="dialog"
      aria-label="Prepare images"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: palette.panelBg,
          color: palette.text,
          border: `1px solid ${palette.panelBorder}`,
          borderRadius: 6,
          padding: 16,
          maxWidth: 640,
          width: "90%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 16,
            color: palette.textHeading,
          }}
        >
          Prepare {files.length} image{files.length === 1 ? "" : "s"}
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: palette.textMuted }}>
          Choose a name and binarisation for each. <strong>Dither</strong>{" "}
          (Floyd-Steinberg) gives photo-like grey illusion via diffusion;{" "}
          <strong>Threshold</strong> binarises at 50% luminance with no
          stipple — best for line art, logos, or pre-prepared 1-bit scans.
        </p>

        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {rows.map((row, i) => {
            const file = files[i];
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: 8,
                  border: `1px solid ${palette.panelBorder}`,
                  borderRadius: 4,
                  background: palette.bg,
                }}
              >
                {row.previewUrl && (
                  <img
                    src={row.previewUrl}
                    alt={`preview for ${file.name}`}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: "contain",
                      background: "#fff",
                      borderRadius: 3,
                      flexShrink: 0,
                    }}
                  />
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{ fontSize: 11, color: palette.textMuted }}
                    title={file.name}
                  >
                    {file.name}
                  </div>
                  <input
                    aria-label={`name for ${file.name}`}
                    type="text"
                    maxLength={MAX_NAME_CHARS}
                    value={row.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                    style={{
                      padding: "4px 6px",
                      fontSize: 13,
                      color: palette.text,
                      background: palette.inputBg,
                      border: `1px solid ${palette.inputBorder}`,
                      borderRadius: 3,
                    }}
                  />
                  <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                    <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="radio"
                        name={`alg-${i}`}
                        checked={row.algorithm === "fs"}
                        onChange={() => updateRow(i, { algorithm: "fs" })}
                        aria-label={`Dither (Floyd-Steinberg) for ${file.name}`}
                      />
                      Dither (Floyd-Steinberg)
                    </label>
                    <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="radio"
                        name={`alg-${i}`}
                        checked={row.algorithm === "threshold"}
                        onChange={() => updateRow(i, { algorithm: "threshold" })}
                        aria-label={`Threshold (no dither) for ${file.name}`}
                      />
                      Threshold (no dither)
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: palette.buttonBg,
              color: palette.text,
              border: `1px solid ${palette.buttonBorder}`,
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onConfirmClick}
            disabled={!allNamesNonEmpty}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 600,
              background: palette.buttonBgActive,
              color: palette.text,
              border: `1px solid ${palette.buttonBorder}`,
              borderRadius: 3,
              cursor: allNamesNonEmpty ? "pointer" : "not-allowed",
              opacity: allNamesNonEmpty ? 1 : 0.5,
            }}
          >
            {confirmLabel ?? "Upload all"}
          </button>
        </div>
      </div>
    </div>
  );
}

function stemOf(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const tail = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
  const dot = tail.lastIndexOf(".");
  const stem = dot > 0 ? tail.slice(0, dot) : tail;
  const trimmed = stem.trim();
  return trimmed.length > 0 ? trimmed : "image";
}

function tryCreateObjectURL(file: File): string | null {
  // jsdom doesn't ship URL.createObjectURL by default. Production
  // browsers always have it. The preview thumbnail is purely a UI
  // affordance — silently degrade to "no thumb" if it isn't there.
  if (typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function tryRevokeObjectURL(url: string): void {
  if (typeof URL.revokeObjectURL !== "function") return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Best-effort cleanup; nothing to do if the polyfill rejects.
  }
}
