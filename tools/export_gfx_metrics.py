#!/usr/bin/env python3
"""Export Adafruit GFX font metrics to a TypeScript module for the editor.

WHY THIS EXISTS
---------------
The firmware renders CAN-driven fields with embedded Adafruit GFX bitmap
fonts (src/text_render.cpp). The editor rasterises everything else with
browser fonts. That mismatch is normally harmless — a template's exported
background leaves CAN field boxes blank, so no browser-rendered glyph ever
reaches the panel.

What it is NOT harmless for is the *preview*. The whole argument for choosing
fixed-size clip-and-ellipsis over shrink-to-fit (docs/phased-build-plan.md
Phase 14) was that the author sees exactly where their text will truncate.
That only holds if the editor measures with the device's real advance widths.
Guessing from a browser font would put the ellipsis in the wrong place, which
is worse than no preview at all: it looks authoritative and is wrong.

So: parse the GFX font headers, emit the per-character advance table plus
ascent/descent, and let the editor do the identical arithmetic that
src/text_fit.h does.

Glyph shapes in the preview are still browser-rendered and therefore
approximate. Only the METRICS are exact — which is the half that determines
truncation and alignment.

USAGE
-----
    python tools/export_gfx_metrics.py

Reads the vendored Adafruit GFX headers out of .pio/libdeps (so it needs a
`pio run` first) and writes web/src/editor/fontMetrics.ts.

Re-run after changing the FONTS table in src/text_render.cpp. CI re-runs it
and fails on a diff, the same guard tools/rasterise_icons.py has.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web" / "src" / "editor" / "fontMetrics.ts"

# Must mirror the FONTS table in src/text_render.cpp, in FontId order.
# (header stem, size multiplier, TS label)
FONTS: list[tuple[str, int, str]] = [
    ("FreeSans9pt7b", 1, "Sans 9"),
    ("FreeSans12pt7b", 1, "Sans 12"),
    ("FreeSansBold12pt7b", 1, "Sans Bold 12"),
    ("FreeSansBold18pt7b", 1, "Sans Bold 18"),
    ("FreeSansBold24pt7b", 1, "Sans Bold 24"),
    ("FreeSansBold24pt7b", 2, "Sans Bold 24 ×2 (hero)"),
    ("FreeMonoBold18pt7b", 1, "Mono Bold 18"),
    ("FreeMonoBold24pt7b", 1, "Mono Bold 24"),
]

FIRST_PRINTABLE = 0x20
LAST_PRINTABLE = 0x7E
TABLE_LEN = LAST_PRINTABLE - FIRST_PRINTABLE + 1  # 95

GLYPH_RE = re.compile(
    r"\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}"
)


def find_font_dir() -> Path:
    """Locate the vendored Adafruit GFX Fonts directory."""
    candidates = sorted(
        (REPO / ".pio" / "libdeps").glob("*/Adafruit GFX Library/Fonts")
    )
    if not candidates:
        sys.exit(
            "Could not find the Adafruit GFX Fonts directory under .pio/libdeps.\n"
            "Run `pio run -e esp32s3-net` first so PlatformIO vendors the library."
        )
    return candidates[0]


def parse_font(path: Path) -> tuple[list[dict[str, int]], int, int, int]:
    """Return (glyphs, first, last, yAdvance) for one GFX font header."""
    text = path.read_text(encoding="utf-8", errors="replace")

    # The glyph array runs from `const GFXglyph ...[] PROGMEM = {` to the
    # closing `};`. Slicing on that boundary keeps the bitmap array's own
    # brace-free hex out of the match.
    start = text.index("GFXglyph")
    start = text.index("{", start)
    end = text.index("};", start)
    glyph_blob = text[start:end]

    glyphs = [
        {
            "bitmapOffset": int(m[0]),
            "width": int(m[1]),
            "height": int(m[2]),
            "xAdvance": int(m[3]),
            "xOffset": int(m[4]),
            "yOffset": int(m[5]),
        }
        for m in GLYPH_RE.findall(glyph_blob)
    ]

    # The GFXfont struct tail: `..., 0x20, 0x7E, 56};`
    tail = text[end:]
    nums = re.findall(r"0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*,\s*(\d+)", tail)
    if not nums:
        sys.exit(f"{path.name}: could not parse the GFXfont first/last/yAdvance tail")
    first, last, yadv = int(nums[0][0], 16), int(nums[0][1], 16), int(nums[0][2])

    return glyphs, first, last, yadv


def build_entry(font_dir: Path, stem: str, size: int, label: str) -> dict:
    glyphs, first, last, yadv = parse_font(font_dir / f"{stem}.h")

    def glyph_for(codepoint: int) -> dict | None:
        if codepoint < first or codepoint > last:
            return None
        idx = codepoint - first
        return glyphs[idx] if idx < len(glyphs) else None

    # Fallback width, mirroring text_render.cpp's substitute handling.
    sub = glyph_for(ord("?"))
    sub_adv = (sub["xAdvance"] * size) if sub else 6 * size

    advances: list[int] = []
    max_ascent = 0
    max_descent = 0
    for cp in range(FIRST_PRINTABLE, LAST_PRINTABLE + 1):
        g = glyph_for(cp)
        advances.append((g["xAdvance"] * size) if g else sub_adv)
        if g:
            # yOffset is baseline-to-glyph-top and negative above the
            # baseline, so ascent is -yOffset and descent is yOffset+height.
            max_ascent = max(max_ascent, -g["yOffset"])
            max_descent = max(max_descent, g["yOffset"] + g["height"])

    assert len(advances) == TABLE_LEN, f"{stem}: {len(advances)} advances, want {TABLE_LEN}"

    return {
        "label": label,
        "ascent": max_ascent * size,
        "descent": max_descent * size,
        "lineHeight": yadv * size,
        "advances": advances,
    }


def main() -> None:
    font_dir = find_font_dir()
    entries = [build_entry(font_dir, stem, size, label) for stem, size, label in FONTS]

    lines: list[str] = []
    lines.append("/**")
    lines.append(" * GENERATED by tools/export_gfx_metrics.py — do not edit by hand.")
    lines.append(" *")
    lines.append(" * Per-font metrics for the firmware's embedded Adafruit GFX bitmap fonts,")
    lines.append(" * so the editor can predict truncation and alignment EXACTLY as the panel")
    lines.append(" * will render them. Indexed by `region::FontId` (src/region.h); those")
    lines.append(" * numeric values are on the wire, so this array may be appended to but")
    lines.append(" * never reordered.")
    lines.append(" *")
    lines.append(" * `advances[i]` is the pixel advance of ASCII character (0x20 + i).")
    lines.append(" * Glyph SHAPES in the editor preview are still browser-rendered and")
    lines.append(" * therefore approximate; only these metrics are exact.")
    lines.append(" */")
    lines.append("")
    lines.append("export const FIRST_PRINTABLE = 0x20;")
    lines.append("export const LAST_PRINTABLE = 0x7e;")
    lines.append(f"export const ADVANCE_TABLE_LEN = {TABLE_LEN};")
    lines.append("")
    lines.append("export interface GfxFontMetrics {")
    lines.append("  /** Human label for the font picker. */")
    lines.append("  label: string;")
    lines.append("  /** Tallest extent above the baseline, px. */")
    lines.append("  ascent: number;")
    lines.append("  /** Deepest extent below the baseline, px. */")
    lines.append("  descent: number;")
    lines.append("  /** Font line advance, px. */")
    lines.append("  lineHeight: number;")
    lines.append("  /** ADVANCE_TABLE_LEN entries, indexed by (charCode - FIRST_PRINTABLE). */")
    lines.append("  advances: readonly number[];")
    lines.append("}")
    lines.append("")
    lines.append("export const GFX_FONTS: readonly GfxFontMetrics[] = [")
    for e in entries:
        lines.append("  {")
        lines.append(f"    label: {e['label']!r},".replace("'", '"'))
        lines.append(f"    ascent: {e['ascent']},")
        lines.append(f"    descent: {e['descent']},")
        lines.append(f"    lineHeight: {e['lineHeight']},")
        adv = ", ".join(str(a) for a in e["advances"])
        lines.append(f"    advances: [{adv}],")
        lines.append("  },")
    lines.append("] as const;")
    lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")

    print(f"wrote {OUT.relative_to(REPO)}")
    for i, (e, (stem, size, _)) in enumerate(zip(entries, FONTS)):
        print(
            f"  [{i}] {stem} x{size}: ascent={e['ascent']} descent={e['descent']} "
            f"line={e['lineHeight']} 'M'={e['advances'][ord('M') - FIRST_PRINTABLE]}px"
        )


if __name__ == "__main__":
    main()
