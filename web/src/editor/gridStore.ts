/**
 * Grid + snap + border settings. Held in its own zustand store so the
 * editor's undoable history doesn't churn on every grid-toggle: these
 * are view preferences, not document content.
 *
 * Persists through localStorage so the user doesn't have to re-enable
 * snap each session.
 */

import { create } from "zustand";

const STORAGE_KEY = "clapboard.grid";

export interface GridState {
  spacing: number;
  snapEnabled: boolean;
  visible: boolean;
  /**
   * Pixel width of the staging border drawn around the 800×480 frame.
   * 0 disables the border entirely (default). When non-zero, the
   * Konva stage grows by `2 * borderWidth` in each axis; element
   * coordinates remain in [0, 800] × [0, 480] for the rasterised
   * region, but placement is allowed up to the outer edge of the
   * border (i.e. `x ∈ [-borderWidth, WIDTH + borderWidth - w]`).
   */
  borderWidth: number;
  setSpacing: (n: number) => void;
  setSnapEnabled: (b: boolean) => void;
  setVisible: (b: boolean) => void;
  setBorderWidth: (n: number) => void;
}

export const MIN_GRID = 2;
export const MAX_GRID = 200;
export const MIN_BORDER = 20;
export const MAX_BORDER = 200;
export const DEFAULT_BORDER_WIDTH = 20;

interface Persisted {
  spacing: number;
  snapEnabled: boolean;
  visible: boolean;
  borderWidth: number;
}

function loadPersisted(): Persisted {
  const fallback: Persisted = {
    spacing: 10,
    snapEnabled: false,
    visible: false,
    borderWidth: 0,
  };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      spacing: clampGrid(typeof parsed.spacing === "number" ? parsed.spacing : 10),
      snapEnabled: !!parsed.snapEnabled,
      visible: !!parsed.visible,
      borderWidth: clampBorder(
        typeof parsed.borderWidth === "number" ? parsed.borderWidth : 0,
      ),
    };
  } catch {
    return fallback;
  }
}

function persist(state: Persisted): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode — best effort.
  }
}

export function clampGrid(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(n)));
}

/**
 * Clamp the staging border width. 0 (off) is the only value below
 * MIN_BORDER that's valid; any other positive request snaps into
 * [MIN_BORDER, MAX_BORDER]. Negative values are coerced to 0.
 */
export function clampBorder(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  return Math.max(MIN_BORDER, Math.min(MAX_BORDER, Math.round(n)));
}

export function snap(value: number, spacing: number, enabled: boolean): number {
  if (!enabled || spacing <= 0) return value;
  return Math.round(value / spacing) * spacing;
}

const initial = loadPersisted();

export const useGridStore = create<GridState>((set, get) => ({
  spacing: initial.spacing,
  snapEnabled: initial.snapEnabled,
  visible: initial.visible,
  borderWidth: initial.borderWidth,
  setSpacing: (n) => {
    set({ spacing: clampGrid(n) });
    persist(snapshot(get()));
  },
  setSnapEnabled: (b) => {
    set({ snapEnabled: b });
    persist(snapshot(get()));
  },
  setVisible: (b) => {
    set({ visible: b });
    persist(snapshot(get()));
  },
  setBorderWidth: (n) => {
    set({ borderWidth: clampBorder(n) });
    persist(snapshot(get()));
  },
}));

function snapshot(s: GridState): Persisted {
  return {
    spacing: s.spacing,
    snapEnabled: s.snapEnabled,
    visible: s.visible,
    borderWidth: s.borderWidth,
  };
}
