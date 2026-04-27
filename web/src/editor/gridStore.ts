/**
 * Grid + snap settings. Held in its own zustand store so the editor's
 * undoable history doesn't churn on every grid-toggle: grid state is
 * a view preference, not document content.
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
  setSpacing: (n: number) => void;
  setSnapEnabled: (b: boolean) => void;
  setVisible: (b: boolean) => void;
}

export const MIN_GRID = 2;
export const MAX_GRID = 200;

interface Persisted {
  spacing: number;
  snapEnabled: boolean;
  visible: boolean;
}

function loadPersisted(): Persisted {
  const fallback: Persisted = { spacing: 10, snapEnabled: false, visible: false };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      spacing: clampGrid(typeof parsed.spacing === "number" ? parsed.spacing : 10),
      snapEnabled: !!parsed.snapEnabled,
      visible: !!parsed.visible,
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

export function snap(value: number, spacing: number, enabled: boolean): number {
  if (!enabled || spacing <= 0) return value;
  return Math.round(value / spacing) * spacing;
}

const initial = loadPersisted();

export const useGridStore = create<GridState>((set, get) => ({
  spacing: initial.spacing,
  snapEnabled: initial.snapEnabled,
  visible: initial.visible,
  setSpacing: (n) => {
    set({ spacing: clampGrid(n) });
    const s = get();
    persist({ spacing: s.spacing, snapEnabled: s.snapEnabled, visible: s.visible });
  },
  setSnapEnabled: (b) => {
    set({ snapEnabled: b });
    const s = get();
    persist({ spacing: s.spacing, snapEnabled: s.snapEnabled, visible: s.visible });
  },
  setVisible: (b) => {
    set({ visible: b });
    const s = get();
    persist({ spacing: s.spacing, snapEnabled: s.snapEnabled, visible: s.visible });
  },
}));
