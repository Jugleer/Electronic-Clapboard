"""Vendor Tabler icons → 128×128 grayscale PNG masters in
``web/public/icons/<category>/<id>.png``.

Run once at vendoring time (or whenever ``ICONS`` is edited). Network is
required: SVG sources are fetched from the @tabler/icons CDN at the
pinned version below and cached under ``tools/icons-cache/`` so reruns
are offline-fast. The committed PNGs are what the editor actually uses
at runtime; this script is only a "how to refresh" reference, not a CI
step.

Each Tabler outline SVG is composited over white and converted to ``L``
(8-bit grayscale). Downstream the editor draws the PNG via 2D-context
``drawImage`` (bilinear scale to placed size) and ``packFrame`` does
threshold-binarisation. Pre-rasterising to a checked-in PNG sidesteps
the SVG-rasteriser drift between browser Skia and @napi-rs/canvas
(resvg) so the visual snapshot is reproducible.

Tabler Icons are MIT licensed (https://tabler.io/icons). The licence
and the pinned vendor SHA are recorded in ``docs/icons.md``.
"""

from __future__ import annotations

import sys
import urllib.request
from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image

TABLER_VERSION = "3.24.0"
CDN_TEMPLATE = (
    "https://cdn.jsdelivr.net/npm/@tabler/icons@"
    + TABLER_VERSION
    + "/icons/outline/{name}.svg"
)
MASTER_SIZE = 128

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / "icons-cache"
OUT_ROOT = REPO_ROOT / "web" / "public" / "icons"

# (category, tabler_name, label).  Categories and order are mirrored in
# web/src/editor/icons/registry.ts. Film comes first; everything else
# follows.
ICONS: list[tuple[str, str, str]] = [
    # ── film & production ──────────────────────────────────────────
    ("film", "movie", "Clapboard"),
    ("film", "camera", "Camera"),
    ("film", "video", "Video camera"),
    ("film", "photo", "Photo"),
    ("film", "microphone", "Microphone"),
    ("film", "microphone-2", "Lapel mic"),
    ("film", "headphones", "Headphones"),
    ("film", "music", "Music"),
    ("film", "disc", "Reel"),
    ("film", "brand-youtube", "Stream"),
    ("film", "broadcast", "Broadcast"),
    ("film", "speakerphone", "Megaphone"),
    ("film", "bulb", "Bulb"),
    ("film", "lamp", "Lamp"),
    ("film", "bolt", "Strobe"),
    ("film", "eye", "POV"),
    ("film", "focus-2", "Focus"),
    ("film", "aperture", "Aperture"),
    ("film", "user", "Talent"),
    ("film", "users", "Crew"),
    ("film", "armchair-2", "Director's chair"),
    ("film", "clock", "Clock"),
    ("film", "calendar", "Calendar"),
    ("film", "hourglass", "Hourglass"),
    ("film", "theater", "Theater"),

    # ── arrows ─────────────────────────────────────────────────────
    ("arrows", "arrow-up", "Arrow up"),
    ("arrows", "arrow-down", "Arrow down"),
    ("arrows", "arrow-left", "Arrow left"),
    ("arrows", "arrow-right", "Arrow right"),
    ("arrows", "arrow-up-right", "Arrow ↗"),
    ("arrows", "arrow-up-left", "Arrow ↖"),
    ("arrows", "arrow-down-right", "Arrow ↘"),
    ("arrows", "arrow-down-left", "Arrow ↙"),
    ("arrows", "arrow-back-up", "Undo"),
    ("arrows", "arrow-forward-up", "Redo"),

    # ── symbols ────────────────────────────────────────────────────
    ("symbols", "circle", "Circle"),
    ("symbols", "square", "Square"),
    ("symbols", "triangle", "Triangle"),
    ("symbols", "star", "Star"),
    ("symbols", "heart", "Heart"),
    ("symbols", "hexagon", "Hexagon"),
    ("symbols", "plus", "Plus"),
    ("symbols", "minus", "Minus"),
    ("symbols", "x", "Cross"),
    ("symbols", "check", "Check"),
    ("symbols", "question-mark", "Question"),
    ("symbols", "exclamation-mark", "Exclamation"),

    # ── emoji-ish faces (Tabler "mood-*" outline) ──────────────────
    ("emoji", "mood-smile", "Smile"),
    ("emoji", "mood-happy", "Happy"),
    ("emoji", "mood-sad", "Sad"),
    ("emoji", "mood-neutral", "Neutral"),
    ("emoji", "mood-confuzed", "Confused"),
    ("emoji", "mood-cry", "Cry"),
    ("emoji", "mood-wink", "Wink"),
    ("emoji", "mood-tongue", "Tongue"),

    # ── misc ──────────────────────────────────────────────────────
    ("misc", "home", "Home"),
    ("misc", "map-pin", "Pin"),
    ("misc", "bookmark", "Bookmark"),
    ("misc", "flag", "Flag"),
    ("misc", "bell", "Bell"),
    ("misc", "wifi", "Wi-Fi"),
    ("misc", "qrcode", "QR"),
    ("misc", "battery", "Battery"),
]


def fetch_svg(name: str) -> bytes:
    cache_path = CACHE_DIR / f"{name}.svg"
    if cache_path.is_file():
        return cache_path.read_bytes()
    url = CDN_TEMPLATE.format(name=name)
    print(f"  fetch {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=20) as resp:
        if resp.status != 200:
            raise RuntimeError(f"fetch {url} → HTTP {resp.status}")
        data = resp.read()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return data


def rasterise(svg: bytes) -> Image.Image:
    png_bytes = cairosvg.svg2png(
        bytestring=svg,
        output_width=MASTER_SIZE,
        output_height=MASTER_SIZE,
    )
    rgba = Image.open(BytesIO(png_bytes)).convert("RGBA")
    # Composite over solid white so transparent regions become paper
    # and stroked regions stay close to ink.
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(white, rgba).convert("L")
    return flat


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    written = 0
    for category, name, _label in ICONS:
        cat_dir = OUT_ROOT / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        out_path = cat_dir / f"{name}.png"
        svg = fetch_svg(name)
        img = rasterise(svg)
        img.save(out_path, format="PNG", optimize=True)
        written += 1
        print(f"  wrote {out_path.relative_to(REPO_ROOT)} ({out_path.stat().st_size} B)")
    print(f"done -- {written} icons -> {OUT_ROOT.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
