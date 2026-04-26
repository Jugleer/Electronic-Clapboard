"""
Wire-format spec module for the Electronic Clapboard frame protocol.

Authoritative reference for §1 of docs/protocol.md. The browser-side
mirror is web/src/frameFormat.ts; equivalence is enforced by a binary
fixture committed under web/src/__fixtures__/.

Any change to constants or packing here is a v1 -> v2 protocol break:
update docs/protocol.md, regenerate the cross-language fixture, and
update the JS mirror in the same commit.
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Iterable

WIDTH = 800
HEIGHT = 480
FRAME_BYTES = (WIDTH // 8) * HEIGHT  # 48000


def pack_1bpp_msb(pixels: Sequence[object] | Iterable[object]) -> bytes:
    """Pack ``WIDTH * HEIGHT`` truthy/falsy pixels into 1bpp MSB-first bytes.

    Pixels are row-major, top-to-bottom, left-to-right. Truthy = ink (black,
    bit set). Falsy = paper (white, bit clear). Within each byte, the
    leftmost pixel of the group of 8 occupies bit 7 (``0x80``); the rightmost
    occupies bit 0 (``0x01``). Output length is always ``FRAME_BYTES``.
    """
    pixels = list(pixels)
    if len(pixels) != WIDTH * HEIGHT:
        raise ValueError(
            f"expected {WIDTH * HEIGHT} pixels, got {len(pixels)}"
        )

    out = bytearray(FRAME_BYTES)
    for y in range(HEIGHT):
        row_base = y * WIDTH
        byte_base = y * (WIDTH // 8)
        for byte_idx in range(WIDTH // 8):
            b = 0
            px_base = row_base + byte_idx * 8
            for bit in range(8):
                if pixels[px_base + bit]:
                    b |= 1 << (7 - bit)
            out[byte_base + byte_idx] = b
    return bytes(out)


def unpack_1bpp_msb(data: bytes) -> list[int]:
    """Inverse of :func:`pack_1bpp_msb`. Returns a list of ``0`` / ``1`` ints
    of length ``WIDTH * HEIGHT``.
    """
    if len(data) != FRAME_BYTES:
        raise ValueError(f"expected {FRAME_BYTES} bytes, got {len(data)}")

    out: list[int] = [0] * (WIDTH * HEIGHT)
    for y in range(HEIGHT):
        row_base = y * WIDTH
        byte_base = y * (WIDTH // 8)
        for byte_idx in range(WIDTH // 8):
            b = data[byte_base + byte_idx]
            px_base = row_base + byte_idx * 8
            for bit in range(8):
                out[px_base + bit] = 1 if (b >> (7 - bit)) & 1 else 0
    return out
