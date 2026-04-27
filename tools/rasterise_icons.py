"""Vendor Tabler icons → 128×128 RGBA PNG masters in
``web/public/icons/<category>/<id>.png``.

Run once at vendoring time (or whenever ``ICONS`` is edited). Network
is required: SVG sources are fetched from the @tabler/icons CDN at the
pinned version below and cached under ``tools/icons-cache/`` so reruns
are offline-fast. The committed PNGs are what the editor actually uses
at runtime; this script is only a "how to refresh" reference, not a CI
step.

Each Tabler outline SVG is rasterised to an RGBA PNG with the original
alpha preserved — strokes are black, the rest is fully transparent.
The editor's render path reads alpha to decide whether each pixel
contributes to the rasterised frame; transparent regions become paper.
Pre-rasterising to a checked-in PNG sidesteps the SVG-rasteriser drift
between browser Skia and @napi-rs/canvas (resvg) so the visual
snapshot stays reproducible.

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
    # Keep the original alpha channel — Tabler outline SVGs render as
    # black strokes on a transparent canvas. The editor's drawIcon
    # reads alpha to decide what's ink; whatever's transparent becomes
    # paper at rasterise time.
    return rgba


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    written = 0
    for category, name, _label in ICONS:
        cat_dir = OUT_ROOT / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        out_path = cat_dir / f"{name}.png"
        svg = fetch_svg(name)
        img = rasterise(svg)
        # Assert RGBA mode before save: drawIcon in the editor reads
        # alpha to decide which pixels are stroke. An L-mode PNG (no
        # alpha channel) decodes opaque-everywhere in the browser and
        # renders as a solid black/white box. PIL's optimize=True is
        # known to collapse RGBA→L when the RGB channels are all zero
        # (the Tabler black-stroke case); plain save preserves RGBA.
        if img.mode != "RGBA":
            raise RuntimeError(
                f"{name}: rasterise produced mode={img.mode}, expected RGBA. "
                "drawIcon needs the alpha channel to distinguish stroke "
                "from background.",
            )
        img.save(out_path, format="PNG")
        # Re-open and verify so a downstream PNG-saver bug never
        # silently writes a stripped file (PIL has done this before
        # under optimize=True; this catch is the canary for any
        # future regression).
        verify = Image.open(out_path)
        if verify.mode != "RGBA":
            raise RuntimeError(
                f"{out_path.name} written as mode={verify.mode}, expected "
                "RGBA. The editor will render this icon as a solid box.",
            )
        written += 1
        print(f"  wrote {out_path.relative_to(REPO_ROOT)} ({out_path.stat().st_size} B)")
    print(f"done -- {written} icons -> {OUT_ROOT.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
