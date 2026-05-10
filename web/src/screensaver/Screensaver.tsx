/**
 * Screensaver slate-set manager (Phase 10+).
 *
 * The cycle itself runs on the device — RTC timer-wakes paint slates
 * untethered. This panel is the editor-side admin surface, fully
 * decoupled from the editor's element pipeline:
 *   - List occupied slots from /screensaver/manifest.
 *   - Upload images → next-free-slot → POST.
 *   - Rename / delete / cycle interval / picker mode / enabled.
 *   - Surface the rtc_synced fall-back when wallclock_hybrid is
 *     configured but not yet anchored.
 *
 * Slates are completely separate from the editor canvas. There is no
 * "push current canvas" affordance — uploaded images dither + pack
 * directly to the device's slate set, which only paints between
 * awake sessions.
 *
 * Wire details: see [docs/protocol.md](../../../docs/protocol.md) §2.6.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ImagePrepareModal,
  type ImagePrepareDecision,
} from "../editor/ImagePrepareModal";
import type { Palette } from "../editor/themeStore";
import {
  deleteSlate,
  getManifest,
  pushSlate,
  renameSlate,
  setConfig,
  type ApiOptions,
  type Manifest,
  type PickerMode,
  type Result,
} from "./manifest";
import { renderScreensaverImageToBytes } from "./sendImage";

interface Props {
  host: string;
  palette: Palette;
  /** Notified after every action so the global StatusReadout can pick
   *  up success/error messages without this panel knowing about it. */
  onSent?: (label: string, ok: boolean, err?: string) => void;
  /** Test-only: inject a fetch + sleep so vitest doesn't need to mock
   *  the global. App.tsx leaves these undefined. */
  apiOptionsOverride?: Partial<ApiOptions>;
}

const POLL_AWAKE_MS = 8_000;
const MAX_NAME_CHARS = 32;

export function ScreensaverPanel({
  host,
  palette,
  onSent,
  apiOptionsOverride,
}: Props) {
  const apiOpts = useMemo<ApiOptions>(
    () => ({ host, ...apiOptionsOverride }),
    [host, apiOptionsOverride],
  );

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ slot: number; name: string } | null>(null);
  // When non-null, the prepare modal is open against this batch. The
  // user picks per-file algorithm + name, then onConfirm runs the
  // sequential upload loop. Cancelling clears the batch.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Local mirrors of the config so the user can edit before pushing.
  // Initialised lazily from the manifest on first load.
  const [intervalDraft, setIntervalDraft] = useState<number>(300);
  const [enabledDraft, setEnabledDraft] = useState<boolean>(false);
  const [pickerDraft, setPickerDraft] = useState<PickerMode>("round_robin");
  const initialisedFromManifest = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- Manifest fetch / poll ----------------------------------------------

  // Returns the *current* manifest if available, or fetches a fresh one.
  // The upload flow needs a snapshot it can compute next-free-slot
  // against between sequential pushes; we fetch a fresh manifest after
  // every push rather than trusting the cached one.
  const fetchFreshManifest = useCallback(async (): Promise<Manifest | null> => {
    const r = await getManifest(apiOpts);
    if (r.ok) {
      setManifest(r);
      return r;
    }
    setLoadError(`${r.code}: ${r.error}`);
    return null;
  }, [apiOpts]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    const r = await fetchFreshManifest();
    if (r && !initialisedFromManifest.current) {
      // First successful load seeds the editable drafts so the user
      // sees the device's current values, not the React defaults.
      setIntervalDraft(r.cycle_interval_s);
      setEnabledDraft(r.enabled);
      setPickerDraft(r.picker_mode);
      initialisedFromManifest.current = true;
    }
  }, [fetchFreshManifest]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_AWAKE_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // --- Action helper ------------------------------------------------------

  const runAction = useCallback(
    async <T,>(label: string, op: () => Promise<Result<T>>) => {
      setBusy(label);
      try {
        const r = await op();
        if (r.ok) {
          onSent?.(label, true);
        } else {
          onSent?.(label, false, `${r.code}: ${r.error}`);
        }
        await fetchFreshManifest();
        return r;
      } finally {
        setBusy(null);
      }
    },
    [fetchFreshManifest, onSent],
  );

  // --- Upload images ------------------------------------------------------

  // Sequentially upload each prepared file to the lowest-numbered
  // unoccupied slot, using the per-file algorithm chosen in the
  // prepare modal. We refresh the manifest between pushes so the
  // next assignment sees the slot we just filled. Stops early (and
  // reports) if all 50 slots are occupied.
  const handleDecisions = useCallback(
    async (decisions: ImagePrepareDecision[]) => {
      if (decisions.length === 0) return;
      setBusy("upload images");
      let snapshot: Manifest | null = manifest ?? (await fetchFreshManifest());
      let uploaded = 0;
      try {
        for (const decision of decisions) {
          if (!snapshot) {
            onSent?.("upload images", false, "no manifest available");
            return;
          }
          const occupied = new Set(snapshot.slots.map((s) => s.slot));
          let target = -1;
          for (let i = 0; i < snapshot.max_slots; i++) {
            if (!occupied.has(i)) { target = i; break; }
          }
          if (target < 0) {
            onSent?.(
              "upload images",
              false,
              `all 50 slots are occupied — delete a slate first (${uploaded} uploaded so far)`,
            );
            return;
          }
          let bytes: Uint8Array;
          try {
            bytes = await renderScreensaverImageToBytes(
              decision.file,
              decision.algorithm,
            );
          } catch (e) {
            onSent?.(
              `upload ${decision.file.name}`,
              false,
              e instanceof Error ? e.message : String(e),
            );
            continue;
          }
          const r = await pushSlate(
            bytes,
            { slot: target, name: decision.name },
            apiOpts,
          );
          if (r.ok) {
            uploaded++;
            onSent?.(
              `upload ${decision.file.name} → slot ${target} (${decision.algorithm})`,
              true,
            );
            // Refresh so the next iteration sees the now-occupied slot.
            snapshot = await fetchFreshManifest();
          } else {
            onSent?.(
              `upload ${decision.file.name}`,
              false,
              `${r.code}: ${r.error}`,
            );
            // Don't auto-bail on a single failure; keep going so a
            // bad image doesn't block the rest of the batch. Refresh
            // anyway in case the firmware accepted partial state.
            snapshot = await fetchFreshManifest();
          }
        }
      } finally {
        setBusy(null);
      }
    },
    [apiOpts, fetchFreshManifest, manifest, onSent],
  );

  const onUploadClick = () => fileInputRef.current?.click();

  // File input change → open the prepare modal. The user picks per-
  // file algorithm + name; on confirm we run the sequential upload
  // pipeline above with their decisions.
  const onFileInputChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";  // allow re-selecting the same file later
    if (files.length > 0) setPendingFiles(files);
  };

  // --- Rename / delete / config ------------------------------------------

  const startRename = (slot: number, currentName: string) =>
    setRenameDraft({ slot, name: currentName });

  const commitRename = useCallback(async () => {
    if (renameDraft === null) return;
    const r = await runAction(`rename slot ${renameDraft.slot}`, () =>
      renameSlate(
        { slot: renameDraft.slot, name: renameDraft.name.trim() },
        apiOpts,
      ),
    );
    if (r.ok) setRenameDraft(null);
  }, [apiOpts, renameDraft, runAction]);

  const onDelete = useCallback(
    async (slot: number) => {
      const ok = window.confirm(`Delete slot ${slot}? This can't be undone.`);
      if (!ok) return;
      await runAction(`delete slot ${slot}`, () =>
        deleteSlate({ slot }, apiOpts),
      );
    },
    [apiOpts, runAction],
  );

  const applyConfig = useCallback(async () => {
    if (manifest === null) return;
    const intervalIsClamped =
      intervalDraft >= manifest.min_cycle_interval_s &&
      intervalDraft <= manifest.max_cycle_interval_s;
    if (!intervalIsClamped) {
      onSent?.(
        "apply config",
        false,
        `interval must be ${manifest.min_cycle_interval_s}..${manifest.max_cycle_interval_s} s`,
      );
      return;
    }
    await runAction("apply config", () =>
      setConfig(
        {
          enabled: enabledDraft,
          cycle_interval_s: intervalDraft,
          picker_mode: pickerDraft,
        },
        apiOpts,
      ),
    );
  }, [apiOpts, enabledDraft, intervalDraft, manifest, onSent, pickerDraft, runAction]);

  // --- Render -------------------------------------------------------------

  if (loadError !== null && manifest === null) {
    return (
      <section style={panelStyle(palette)}>
        <header style={headerStyle(palette)}>Screensaver</header>
        <p style={{ margin: 0, fontSize: 12, color: palette.statusError }}>
          Couldn't reach the device: {loadError}.{" "}
          <button
            type="button"
            onClick={() => void refresh()}
            style={inlineLinkStyle(palette)}
          >
            retry
          </button>
        </p>
      </section>
    );
  }

  if (manifest === null) {
    return (
      <section style={panelStyle(palette)}>
        <header style={headerStyle(palette)}>Screensaver</header>
        <p style={{ margin: 0, fontSize: 12, color: palette.textMuted }}>
          loading…
        </p>
      </section>
    );
  }

  const slots = manifest.slots;
  const empty = slots.length === 0;
  const wallclockFallback =
    manifest.picker_mode === "wallclock_hybrid" &&
    manifest.picker_mode_actual !== "wallclock_hybrid";

  return (
    <section style={panelStyle(palette)} data-testid="screensaver-panel">
      <header style={headerStyle(palette)}>
        Screensaver
        <span
          style={{
            fontWeight: 400,
            fontSize: 12,
            color: palette.textMuted,
            marginLeft: 8,
          }}
        >
          {slots.length} slate{slots.length === 1 ? "" : "s"} · cycle every{" "}
          {manifest.cycle_interval_s} s ·{" "}
          {manifest.enabled ? "enabled" : "disabled"}
          {manifest.current_slot !== null
            ? ` · now playing slot ${manifest.current_slot}`
            : ""}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: 11, color: palette.textMuted }}>
        Slates show on the device's panel between awake sessions. They're
        independent of the editor canvas.
      </p>

      {wallclockFallback && (
        <div
          role="status"
          style={{
            fontSize: 12,
            padding: "6px 8px",
            border: `1px dashed ${palette.statusWarn}`,
            color: palette.statusWarn,
            borderRadius: 3,
          }}
        >
          Wallclock-hybrid is configured but the device hasn't synced
          to NTP yet — running round-robin until the next wake-button
          wake associates Wi-Fi.
        </div>
      )}

      {/* Upload images */}
      <div style={rowStyle()}>
        <button
          type="button"
          onClick={onUploadClick}
          disabled={busy !== null || slots.length >= manifest.max_slots}
          style={buttonStyle(palette, /*primary=*/ true)}
        >
          {busy === "upload images" ? "uploading…" : "+ Upload images"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFileInputChange}
          aria-label="upload images"
          style={{ display: "none" }}
        />
        {slots.length >= manifest.max_slots && (
          <span style={{ fontSize: 11, color: palette.statusWarn }}>
            All {manifest.max_slots} slots full — delete a slate to make room.
          </span>
        )}
      </div>

      {/* Slot list */}
      {empty ? (
        <p style={{ margin: 0, fontSize: 12, color: palette.textMuted }}>
          No slates yet — upload images to get started.
        </p>
      ) : (
        <ul
          aria-label="slate slots"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {slots.map((s) => {
            const isCurrent = manifest.current_slot === s.slot;
            const isRenaming = renameDraft?.slot === s.slot;
            return (
              <li
                key={s.slot}
                data-testid={`slot-${s.slot}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 6px",
                  border: `1px solid ${
                    isCurrent ? palette.link : palette.panelBorder
                  }`,
                  background: palette.panelBg,
                  borderRadius: 3,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    color: palette.textMuted,
                    minWidth: 28,
                  }}
                >
                  {String(s.slot).padStart(2, "0")}
                </span>
                {isRenaming ? (
                  <>
                    <input
                      aria-label={`rename slot ${s.slot}`}
                      type="text"
                      maxLength={MAX_NAME_CHARS}
                      value={renameDraft.name}
                      onChange={(e) =>
                        setRenameDraft({
                          slot: s.slot,
                          name: e.target.value,
                        })
                      }
                      style={textInputStyle(palette)}
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename()}
                      disabled={busy !== null}
                      style={buttonStyle(palette)}
                    >
                      save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenameDraft(null)}
                      style={buttonStyle(palette)}
                    >
                      cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ color: palette.text, flex: 1 }}>{s.name}</span>
                    <span
                      style={{ fontSize: 11, color: palette.textMuted }}
                      title={`${s.bytes} B · updated at ${s.updated_at_ms} ms uptime`}
                    >
                      {Math.round(s.bytes / 1024)} KB
                    </span>
                    {isCurrent && (
                      <span
                        style={{
                          fontSize: 11,
                          color: palette.link,
                          fontWeight: 600,
                        }}
                      >
                        ● now playing
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => startRename(s.slot, s.name)}
                      disabled={busy !== null}
                      style={buttonStyle(palette)}
                    >
                      rename
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(s.slot)}
                      disabled={busy !== null}
                      style={buttonStyle(palette)}
                      aria-label={`delete slot ${s.slot}`}
                    >
                      delete
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Cycle config */}
      <div style={{ ...rowStyle(), marginTop: 4, alignItems: "flex-end" }}>
        <label style={labelStyle(palette)}>
          cycle interval (s)
          <input
            aria-label="cycle interval seconds"
            type="number"
            min={manifest.min_cycle_interval_s}
            max={manifest.max_cycle_interval_s}
            value={intervalDraft}
            onChange={(e) =>
              setIntervalDraft(parseIntSafe(e.target.value, intervalDraft))
            }
            onBlur={(e) =>
              setIntervalDraft(
                clamp(
                  parseIntSafe(e.target.value, intervalDraft),
                  manifest.min_cycle_interval_s,
                  manifest.max_cycle_interval_s,
                ),
              )
            }
            style={numberInputStyle(palette)}
          />
        </label>
        <label style={labelStyle(palette)}>
          picker mode
          <select
            aria-label="picker mode"
            value={pickerDraft}
            onChange={(e) => setPickerDraft(e.target.value as PickerMode)}
            style={textInputStyle(palette)}
          >
            <option value="round_robin">round_robin</option>
            <option value="wallclock_hybrid">wallclock_hybrid</option>
          </select>
        </label>
        <label
          style={{
            ...labelStyle(palette),
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <input
            aria-label="enabled"
            type="checkbox"
            checked={enabledDraft}
            onChange={(e) => setEnabledDraft(e.target.checked)}
          />
          <span style={{ marginLeft: 4 }}>enabled</span>
        </label>
        <button
          type="button"
          onClick={() => void applyConfig()}
          disabled={busy !== null}
          style={buttonStyle(palette, /*primary=*/ true)}
        >
          {busy === "apply config" ? "applying…" : "apply"}
        </button>
      </div>

      {pendingFiles.length > 0 && (
        <ImagePrepareModal
          files={pendingFiles}
          palette={palette}
          confirmLabel="Upload all"
          onCancel={() => setPendingFiles([])}
          onConfirm={(decisions) => {
            setPendingFiles([]);
            void handleDecisions(decisions);
          }}
        />
      )}
    </section>
  );
}

// --- helpers ---------------------------------------------------------------

function parseIntSafe(s: string, fallback: number): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// --- styles ----------------------------------------------------------------

function panelStyle(palette: Palette): React.CSSProperties {
  return {
    border: `1px solid ${palette.panelBorder}`,
    background: palette.panelBg,
    padding: 10,
    borderRadius: 4,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };
}

function headerStyle(palette: Palette): React.CSSProperties {
  return {
    fontWeight: 600,
    fontSize: 14,
    color: palette.textHeading,
    display: "flex",
    alignItems: "center",
  };
}

function rowStyle(): React.CSSProperties {
  return {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  };
}

function labelStyle(palette: Palette): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    fontSize: 11,
    color: palette.textMuted,
    gap: 2,
  };
}

function numberInputStyle(palette: Palette): React.CSSProperties {
  return {
    width: 80,
    padding: "4px 6px",
    fontSize: 13,
    color: palette.text,
    background: palette.inputBg,
    border: `1px solid ${palette.inputBorder}`,
    borderRadius: 3,
  };
}

function textInputStyle(palette: Palette): React.CSSProperties {
  return {
    padding: "4px 6px",
    fontSize: 13,
    color: palette.text,
    background: palette.inputBg,
    border: `1px solid ${palette.inputBorder}`,
    borderRadius: 3,
  };
}

function buttonStyle(palette: Palette, primary = false): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    background: primary ? palette.buttonBgActive : palette.buttonBg,
    color: palette.text,
    border: `1px solid ${palette.buttonBorder}`,
    borderRadius: 3,
    cursor: "pointer",
  };
}

function inlineLinkStyle(palette: Palette): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    color: palette.link,
    cursor: "pointer",
    padding: 0,
    fontSize: "inherit",
    textDecoration: "underline",
  };
}
