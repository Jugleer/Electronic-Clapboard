"""Generate the Floyd-Steinberg dither oracle fixture for Phase 6.

PIL's `Image.convert("1", dither=Image.Dither.FLOYDSTEINBERG)` is the
algorithmic reference for our JS dither path. This tool produces a
deterministic small grayscale test image, runs PIL's FS dither against
it, and writes both the L8 input and the expected 1bpp output into a
binary fixture under `web/src/__fixtures__/`. The vitest suite reads
the fixture and asserts byte equality against the JS implementation.

Fixture format (little-endian, no padding):
    magic         : 4 bytes  ASCII "FSO1"
    width         : u16
    height        : u16
    input  L8     : W*H bytes (grayscale 0..255)
    output 1bpp   : ceil(W*H/8) bytes, 1 = INK, MSB-first per byte,
                    rows packed left-to-right top-to-bottom

Note the bit convention is "1 = ink" to match docs/protocol.md §1, NOT
PIL's native "1 = white" — the JS test inverts on its own side, but
we store ink-positive bytes here so this fixture can be reused as a
direct subframe input later if needed.

Run: `python tools/generate_dither_oracle.py`
CI re-runs this and `git diff --exit-code` against the fixture.
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image


# 64 × 32 — small enough to commit (~2 KB), large enough to exercise
# error transport across both axes. Pattern: top half = horizontal
# ramp (rows 0-15), bottom half = diagonal gradient (rows 16-31). The
# ramp catches row-direction error transport; the diagonal catches
# down-row carry.
W, H = 64, 32

OUT_PATH = (
    Path(__file__).resolve().parent.parent
    / "web"
    / "src"
    / "__fixtures__"
    / "fs_oracle_gradient.bin"
)


def build_input() -> bytes:
    rows: list[bytes] = []
    for y in range(H):
        if y < 16:
            # horizontal ramp, identical every row in the top half
            row = bytes(int(x * 255 / (W - 1)) for x in range(W))
        else:
            # diagonal gradient: clamp(x + (y - 16) * 8) so the
            # gradient walks from black at top-left of the lower half
            # to white at the bottom-right.
            row = bytes(
                max(0, min(255, x * 255 // (W - 1) + (y - 16) * 4)) for x in range(W)
            )
        rows.append(row)
    return b"".join(rows)


def pil_fs_pack(buf: bytes) -> bytes:
    img = Image.frombytes("L", (W, H), buf)
    out_1 = img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    raw = out_1.tobytes()
    # PIL '1' mode packs MSB-first per byte with 1 = WHITE. Invert to
    # our 1 = INK convention so the fixture matches docs/protocol.md.
    inverted = bytes(b ^ 0xFF for b in raw)
    # Mask off any padding bits past row end so the fixture is canonical.
    bytes_per_row = (W + 7) // 8
    if W % 8 != 0:
        valid_bits = W % 8
        mask = (0xFF << (8 - valid_bits)) & 0xFF
        out = bytearray(inverted)
        for y in range(H):
            out[y * bytes_per_row + bytes_per_row - 1] &= mask
        inverted = bytes(out)
    return inverted


def main() -> None:
    inp = build_input()
    out = pil_fs_pack(inp)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("wb") as f:
        f.write(b"FSO1")
        f.write(struct.pack("<HH", W, H))
        f.write(inp)
        f.write(out)
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
