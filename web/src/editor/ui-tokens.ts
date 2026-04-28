/**
 * Design tokens — spacing scale, font sizes, radii, elevation. Lives
 * apart from `ui.tsx` so the components there aren't mixed with
 * non-component exports (Vite's react-refresh complains otherwise,
 * and the warning gets noisy as the primitives grow).
 */

import type { Palette } from "./themeStore";

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const fs = {
  caption: 11,
  body: 13,
  label: 14,
  button: 14,
  h2: 18,
  h1: 22,
} as const;

export const radius = {
  default: 3,
  panel: 6,
} as const;

/** Light-mode panel elevation. `none` in dark mode — shadows on dark
 *  surfaces look muddy and don't add depth. */
export function panelShadow(palette: Palette): string {
  return palette.bg === "#ffffff" ? "0 1px 3px rgba(0,0,0,0.06)" : "none";
}
