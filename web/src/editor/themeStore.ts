/**
 * Theme (light/dark) for the editor *chrome*. The 800×480 canvas
 * itself stays white in both modes — the canvas visualises the EPD's
 * paper, and inverting it would mislead about what the panel will
 * actually show. Only surrounding UI (toolbars, panels, body bg,
 * headings, status readouts) responds to this toggle.
 *
 * View-state, not document content — held in its own zustand store so
 * undo/redo doesn't churn on every theme flip, and persisted via
 * localStorage so the user's choice survives reloads.
 */

import { create } from "zustand";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "clapboard.theme";

export interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

function loadPersisted(): ThemeMode {
  if (typeof localStorage === "undefined") return "light";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function persist(mode: ThemeMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Quota / private mode — best effort.
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: loadPersisted(),
  setMode: (mode) => {
    set({ mode });
    persist(mode);
  },
  toggle: () => {
    const next: ThemeMode = get().mode === "light" ? "dark" : "light";
    set({ mode: next });
    persist(next);
  },
}));

/**
 * Resolved palette. Centralising the colours here keeps every panel
 * pulling from the same source — adding a third theme later is
 * mechanical instead of a hunt-and-replace through every `style=`.
 */
export interface Palette {
  bg: string; // page / body background
  panelBg: string; // surface for floating panels (PropertiesPanel, LayerPanel)
  panelBorder: string; // 1 px outline on panels and inputs
  text: string; // primary text colour
  textMuted: string; // captions, helper text
  textHeading: string; // h1, section labels
  buttonBg: string; // toolbar buttons, picker rows
  buttonBgActive: string; // selected/active button state
  buttonBorder: string;
  inputBg: string; // text inputs, selects, textareas
  inputBorder: string;
  link: string; // accent for highlights (the green from #0a7)
  dropZoneBg: string;
  dropZoneBorder: string;
  /**
   * Wash colour for the staging-border zone overlay. White-50% on
   * light mode dims to ~paper-grey; in dark mode we tint with black-
   * 50% over a dark chrome so the wash still reads as "this is
   * outside the live area" without bleaching the dark.
   */
  borderWashFill: string;
  /** Stroke colour for the dashed boundary around the rasterised frame. */
  borderStroke: string;
  /** Statuses */
  statusOk: string;
  statusWarn: string;
  statusError: string;
}

const LIGHT: Palette = {
  bg: "#ffffff",
  panelBg: "#fafafa",
  panelBorder: "#cccccc",
  text: "#222222",
  textMuted: "#888888",
  textHeading: "#111111",
  buttonBg: "#f4f4f4",
  buttonBgActive: "#deeeff",
  buttonBorder: "#bbbbbb",
  inputBg: "#ffffff",
  inputBorder: "#bbbbbb",
  link: "#0a7755",
  dropZoneBg: "#eef7ff",
  dropZoneBorder: "#88bbee",
  borderWashFill: "white",
  borderStroke: "#888888",
  statusOk: "#0a7755",
  statusWarn: "#aa6600",
  statusError: "#bb2222",
};

const DARK: Palette = {
  bg: "#1a1a1d",
  panelBg: "#26262a",
  panelBorder: "#3a3a40",
  text: "#e0e0e2",
  textMuted: "#888892",
  textHeading: "#f5f5f7",
  buttonBg: "#2e2e34",
  buttonBgActive: "#1f4459",
  buttonBorder: "#48484f",
  inputBg: "#1f1f23",
  inputBorder: "#48484f",
  link: "#5fd7a8",
  dropZoneBg: "#1e3a4f",
  dropZoneBorder: "#5599cc",
  borderWashFill: "black",
  borderStroke: "#5a5a64",
  statusOk: "#5fd7a8",
  statusWarn: "#e8b15a",
  statusError: "#e87a7a",
};

export function paletteFor(mode: ThemeMode): Palette {
  return mode === "dark" ? DARK : LIGHT;
}

/**
 * Hook that subscribes to the current theme mode and returns its
 * resolved palette. Components read this once and pass colours down
 * via inline styles — Konva's react bindings don't compose with CSS
 * vars cleanly, and the editor canvas is intentionally untouched by
 * theme anyway.
 */
export function usePalette(): Palette {
  const mode = useThemeStore((s) => s.mode);
  return paletteFor(mode);
}
