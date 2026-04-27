/**
 * Icon registry — single source of truth.
 *
 * IDs are `<category>/<name>` so they survive flat-store roundtrips
 * (saved layouts in Phase 7) without needing a category lookup table.
 * `src` is the public asset path; the loader strips the leading `/` when
 * needed. The PNG masters are 128×128 grayscale, generated from Tabler
 * Icons (MIT) via `tools/rasterise_icons.py`. Master size doesn't appear
 * here — the loader reads `naturalWidth`/`naturalHeight` so changing
 * masters is one place.
 */

export type IconCategory = "film" | "arrows" | "symbols" | "emoji" | "misc";

export interface IconRegistryEntry {
  /** `<category>/<name>` */
  id: string;
  category: IconCategory;
  name: string;
  label: string;
  /** Public asset path served by Vite, e.g. `/icons/film/movie.png` */
  src: string;
}

export const ICON_CATEGORIES: { id: IconCategory; label: string }[] = [
  { id: "film", label: "Film & production" },
  { id: "arrows", label: "Arrows" },
  { id: "symbols", label: "Symbols" },
  { id: "emoji", label: "Emoji" },
  { id: "misc", label: "Misc" },
];

function mk(category: IconCategory, name: string, label: string): IconRegistryEntry {
  return {
    id: `${category}/${name}`,
    category,
    name,
    label,
    src: `/icons/${category}/${name}.png`,
  };
}

export const ICON_REGISTRY: IconRegistryEntry[] = [
  // film
  mk("film", "movie", "Clapboard"),
  mk("film", "camera", "Camera"),
  mk("film", "video", "Video camera"),
  mk("film", "photo", "Photo"),
  mk("film", "microphone", "Microphone"),
  mk("film", "microphone-2", "Lapel mic"),
  mk("film", "headphones", "Headphones"),
  mk("film", "music", "Music"),
  mk("film", "disc", "Reel"),
  mk("film", "brand-youtube", "Stream"),
  mk("film", "broadcast", "Broadcast"),
  mk("film", "speakerphone", "Megaphone"),
  mk("film", "bulb", "Bulb"),
  mk("film", "lamp", "Lamp"),
  mk("film", "bolt", "Strobe"),
  mk("film", "eye", "POV"),
  mk("film", "focus-2", "Focus"),
  mk("film", "aperture", "Aperture"),
  mk("film", "user", "Talent"),
  mk("film", "users", "Crew"),
  mk("film", "armchair-2", "Director's chair"),
  mk("film", "clock", "Clock"),
  mk("film", "calendar", "Calendar"),
  mk("film", "hourglass", "Hourglass"),
  mk("film", "theater", "Theater"),
  // arrows
  mk("arrows", "arrow-up", "Arrow up"),
  mk("arrows", "arrow-down", "Arrow down"),
  mk("arrows", "arrow-left", "Arrow left"),
  mk("arrows", "arrow-right", "Arrow right"),
  mk("arrows", "arrow-up-right", "Arrow up-right"),
  mk("arrows", "arrow-up-left", "Arrow up-left"),
  mk("arrows", "arrow-down-right", "Arrow down-right"),
  mk("arrows", "arrow-down-left", "Arrow down-left"),
  mk("arrows", "arrow-back-up", "Undo"),
  mk("arrows", "arrow-forward-up", "Redo"),
  // symbols
  mk("symbols", "circle", "Circle"),
  mk("symbols", "square", "Square"),
  mk("symbols", "triangle", "Triangle"),
  mk("symbols", "star", "Star"),
  mk("symbols", "heart", "Heart"),
  mk("symbols", "hexagon", "Hexagon"),
  mk("symbols", "plus", "Plus"),
  mk("symbols", "minus", "Minus"),
  mk("symbols", "x", "Cross"),
  mk("symbols", "check", "Check"),
  mk("symbols", "question-mark", "Question"),
  mk("symbols", "exclamation-mark", "Exclamation"),
  // emoji
  mk("emoji", "mood-smile", "Smile"),
  mk("emoji", "mood-happy", "Happy"),
  mk("emoji", "mood-sad", "Sad"),
  mk("emoji", "mood-neutral", "Neutral"),
  mk("emoji", "mood-confuzed", "Confused"),
  mk("emoji", "mood-cry", "Cry"),
  mk("emoji", "mood-wink", "Wink"),
  mk("emoji", "mood-tongue", "Tongue"),
  // misc
  mk("misc", "home", "Home"),
  mk("misc", "map-pin", "Pin"),
  mk("misc", "bookmark", "Bookmark"),
  mk("misc", "flag", "Flag"),
  mk("misc", "bell", "Bell"),
  mk("misc", "wifi", "Wi-Fi"),
  mk("misc", "qrcode", "QR"),
  mk("misc", "battery", "Battery"),
];

const BY_ID = new Map<string, IconRegistryEntry>(
  ICON_REGISTRY.map((e) => [e.id, e]),
);

export function findIcon(id: string): IconRegistryEntry | null {
  return BY_ID.get(id) ?? null;
}

export function iconsInCategory(category: IconCategory): IconRegistryEntry[] {
  return ICON_REGISTRY.filter((e) => e.category === category);
}
