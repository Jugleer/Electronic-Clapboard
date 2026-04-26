"""
Spec tests for tools/frame_format.py.

This module is the single source of truth for the wire format. It is
mirrored in web/src/frameFormat.ts; equivalence is enforced separately
by a binary fixture (web/src/__fixtures__/oracle_frame.bin).

Run from project root:
    pytest tools/test_frame_format.py
"""
from __future__ import annotations

import pytest

from frame_format import (
    FRAME_BYTES,
    HEIGHT,
    WIDTH,
    pack_1bpp_msb,
    unpack_1bpp_msb,
)


# ---------------------------------------------------------------------------
# Constants — these are part of the contract; bumping any of them is a
# v1 -> v2 protocol break and must update docs/protocol.md.
# ---------------------------------------------------------------------------

def test_dimensions_match_protocol():
    assert WIDTH == 800
    assert HEIGHT == 480
    assert FRAME_BYTES == 48000
    assert FRAME_BYTES == (WIDTH // 8) * HEIGHT


# ---------------------------------------------------------------------------
# pack_1bpp_msb takes a flat sequence of 800*480 truthy/falsy pixels (row-
# major, top-to-bottom, left-to-right) where truthy = ink (black) and
# returns exactly FRAME_BYTES bytes, MSB-first within each byte.
# ---------------------------------------------------------------------------

def test_pack_all_white_is_all_zero_bytes():
    pixels = [0] * (WIDTH * HEIGHT)
    out = pack_1bpp_msb(pixels)
    assert isinstance(out, (bytes, bytearray))
    assert len(out) == FRAME_BYTES
    assert out == bytes(FRAME_BYTES)  # all 0x00


def test_pack_all_black_is_all_ff_bytes():
    pixels = [1] * (WIDTH * HEIGHT)
    out = pack_1bpp_msb(pixels)
    assert len(out) == FRAME_BYTES
    assert out == b"\xFF" * FRAME_BYTES


def test_pack_single_pixel_at_origin_sets_msb_of_byte_0():
    """Pixel (x=0, y=0) -> bit 7 of byte 0 (i.e. 0x80). Locks MSB-first."""
    pixels = [0] * (WIDTH * HEIGHT)
    pixels[0] = 1
    out = pack_1bpp_msb(pixels)
    assert out[0] == 0x80
    # Every other byte is zero.
    assert out[1:] == bytes(FRAME_BYTES - 1)


def test_pack_pixel_at_x7_y0_sets_lsb_of_byte_0():
    pixels = [0] * (WIDTH * HEIGHT)
    pixels[7] = 1  # x=7, y=0
    out = pack_1bpp_msb(pixels)
    assert out[0] == 0x01
    assert out[1:] == bytes(FRAME_BYTES - 1)


def test_pack_pixel_at_x8_y0_starts_byte_1():
    pixels = [0] * (WIDTH * HEIGHT)
    pixels[8] = 1  # x=8, y=0 -> first pixel of byte 1
    out = pack_1bpp_msb(pixels)
    assert out[0] == 0x00
    assert out[1] == 0x80
    assert out[2:] == bytes(FRAME_BYTES - 2)


def test_pack_pixel_at_y1_x0_starts_row_1():
    """Row stride is 100 bytes. (x=0, y=1) -> bit 7 of byte 100."""
    pixels = [0] * (WIDTH * HEIGHT)
    pixels[WIDTH] = 1  # x=0, y=1
    out = pack_1bpp_msb(pixels)
    assert out[100] == 0x80
    assert out[:100] == bytes(100)
    assert out[101:] == bytes(FRAME_BYTES - 101)


def test_pack_rejects_wrong_pixel_count():
    with pytest.raises(ValueError):
        pack_1bpp_msb([0] * (WIDTH * HEIGHT - 1))
    with pytest.raises(ValueError):
        pack_1bpp_msb([0] * (WIDTH * HEIGHT + 1))


def test_pack_truthy_values_treated_as_ink():
    """Any non-zero / truthy pixel is ink. Locks the convention so a
    ``True`` from a PIL image and a ``1`` from a numpy array agree."""
    pixels = [0] * (WIDTH * HEIGHT)
    pixels[0] = True
    pixels[1] = 255  # like a PIL '1' or 'L' value pre-thresholding
    pixels[2] = -1
    out = pack_1bpp_msb(pixels)
    # Bits 7, 6, 5 of byte 0 set -> 0b11100000 = 0xE0
    assert out[0] == 0xE0


# ---------------------------------------------------------------------------
# unpack_1bpp_msb is the inverse, exposed mostly for test scaffolding and
# so the JS side has an oracle to cross-check against.
# ---------------------------------------------------------------------------

def test_unpack_inverts_pack():
    # Deterministic checkerboard: pixel set iff (x + y) is even.
    pixels = [(x + y) % 2 == 0 for y in range(HEIGHT) for x in range(WIDTH)]
    packed = pack_1bpp_msb(pixels)
    roundtrip = unpack_1bpp_msb(packed)
    assert len(roundtrip) == WIDTH * HEIGHT
    # Compare as ints to keep the failure message readable.
    assert [int(b) for b in roundtrip] == [int(b) for b in pixels]


def test_unpack_rejects_wrong_byte_count():
    with pytest.raises(ValueError):
        unpack_1bpp_msb(b"\x00" * (FRAME_BYTES - 1))
    with pytest.raises(ValueError):
        unpack_1bpp_msb(b"\x00" * (FRAME_BYTES + 1))


# ---------------------------------------------------------------------------
# Parity oracle: the existing tools/generate_slides.py:encode_1bpp_msb is
# the de facto reference encoder used to bake slide artwork. The new
# frame_format module must produce byte-identical output for the same
# pixels, otherwise we'd have two competing definitions of the wire
# format in one repo.
# ---------------------------------------------------------------------------

def test_parity_with_generate_slides_encoder():
    pytest.importorskip("PIL")
    from PIL import Image

    import generate_slides  # noqa: WPS433  (sibling module in tools/)

    # Construct a deterministic '1'-mode image. PIL's '1' mode stores
    # 0 = black, 255 = white; generate_slides.encode_1bpp_msb inverts at
    # packing time so 1 = ink. We build the same logical image two ways
    # and assert the resulting bytes match.
    rng_pattern = [(x * 31 + y * 7) % 5 == 0 for y in range(HEIGHT)
                   for x in range(WIDTH)]

    img = Image.new("1", (WIDTH, HEIGHT), 1)  # start white (255 in '1' mode)
    px = img.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if rng_pattern[y * WIDTH + x]:
                px[x, y] = 0  # 0 in PIL '1' mode = black ink

    bytes_from_generate = generate_slides.encode_1bpp_msb(img)
    bytes_from_frame_format = pack_1bpp_msb(rng_pattern)

    assert len(bytes_from_generate) == FRAME_BYTES
    assert bytes_from_frame_format == bytes_from_generate
