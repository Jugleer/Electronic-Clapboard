/**
 * Auto-discover screensaver image masters bundled under
 * `web/src/assets/screensaver/`. Vite's `import.meta.glob` resolves at
 * build time, so adding a new file requires a dev-server restart — fine
 * for the temporary 15-second cycle, and means the list is statically
 * known to the bundle (no runtime fetch of a manifest).
 *
 * Bundled images are public-domain mathematical illusions in the spirit
 * of Escher (Penrose triangle, impossible cube, hex tessellation). User-
 * supplied scans dropped into the same directory show up automatically;
 * `personal-*` names are gitignored so copyrighted material stays local.
 */

const modules = import.meta.glob(
  "../assets/screensaver/*.{png,jpg,jpeg,svg,webp,gif}",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

export interface ScreensaverImage {
  /** Stable id derived from the filename (without extension). */
  id: string;
  /** Public-facing label, prettified from the filename. */
  label: string;
  /** Resolved URL the browser can fetch (Vite asset URL). */
  url: string;
}

function prettify(stem: string): string {
  // "01-penrose-triangle" → "Penrose triangle"
  const cleaned = stem.replace(/^\d+[-_]?/, "").replace(/[-_]+/g, " ").trim();
  if (!cleaned) return stem;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export const SCREENSAVER_IMAGES: ScreensaverImage[] = Object.entries(modules)
  .map(([path, url]) => {
    const file = path.split("/").pop() ?? path;
    const stem = file.replace(/\.[^.]+$/, "");
    return { id: stem, label: prettify(stem), url };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
