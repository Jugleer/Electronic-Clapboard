"""Dump one of the demo slides as a raw 48000-byte 1bpp frame.

Used by Phase 2's bench acceptance gate 2 (canonical fixture round-trip),
and any later phase that wants a ready-made `application/octet-stream`
body to POST to /frame. Output matches docs/protocol.md §1 exactly:
1 = ink, MSB-first, scanlines top-to-bottom, 48000 bytes total.

Usage:
    python tools/dump_slide.py --slide clapper_hero --out clapper_hero.bin
    python tools/dump_slide.py --list

The slide functions live in tools/generate_slides.py; this tool just
re-uses them so there's a single source of truth for the demo artwork.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import generate_slides as gs
import frame_format as ff

ROOT = Path(__file__).resolve().parent.parent

SLIDES = {
    "self_portrait": gs.slide_self_portrait,
    "film_camera":   gs.slide_film_camera,
    "clapper_hero":  gs.slide_clapper_hero,
    "reel_moon":     gs.slide_reel_moon,
    "pcb":           gs.slide_pcb,
}


def dump(name: str, out_path: Path) -> int:
    if name not in SLIDES:
        print(f"unknown slide: {name!r}. options: {', '.join(SLIDES)}",
              file=sys.stderr)
        return 2
    img = SLIDES[name]()
    # The slide functions return mode-'L' or 'RGB' images; encode_1bpp_msb
    # asserts mode '1', so dither (Floyd-Steinberg) before packing. This
    # matches what generate_slides.py main() does when emitting the C++
    # header, so the rendered panel here matches the artwork there.
    img1 = gs._to_1bit_dithered(img)
    # IMPORTANT: pack via tools/frame_format.py — the authoritative wire
    # spec, where 1 = ink. generate_slides.encode_1bpp_msb inverts at pack
    # time (it pairs with drawInvertedBitmap in the legacy PROGMEM header
    # pipeline), so using it here would render inverted on the wire. PIL
    # mode '1' stores 0 = black, 255 = white; map black -> 1 (ink).
    px = img1.load()
    pixels = [1 if px[x, y] == 0 else 0
              for y in range(ff.HEIGHT) for x in range(ff.WIDTH)]
    data = ff.pack_1bpp_msb(pixels)
    if len(data) != ff.FRAME_BYTES:
        print(f"BUG: encoded {len(data)} bytes, expected {ff.FRAME_BYTES}",
              file=sys.stderr)
        return 1
    out_path.write_bytes(data)
    print(f"wrote {out_path}  ({len(data)} bytes, slide={name})")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--slide", help="slide name (see --list)")
    p.add_argument("--out", type=Path,
                   help="output .bin path (default: <slide>.bin in cwd)")
    p.add_argument("--list", action="store_true",
                   help="print available slide names and exit")
    args = p.parse_args()

    if args.list:
        for name in SLIDES:
            print(name)
        return 0

    if not args.slide:
        p.error("--slide required (or use --list)")

    out = args.out or Path.cwd() / f"{args.slide}.bin"
    return dump(args.slide, out)


if __name__ == "__main__":
    sys.exit(main())
