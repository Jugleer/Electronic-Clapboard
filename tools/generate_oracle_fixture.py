"""
Generate the cross-language oracle fixture used by web/src/frameFormat.test.ts.

The fixture is a deterministic 48000-byte frame produced by frame_format.py.
Both sides (Python via pack_1bpp_msb, JS via packFrame1bppMsb) must produce
this exact byte sequence from the same logical pixel pattern. Committing it
turns "do the two encoders agree?" into a checked-in artefact rather than a
build-time dependency on Python from the JS test runner.

Run from the project root (CI does this and asserts no diff):
    python tools/generate_oracle_fixture.py

The pattern is the same one used in test_frame_format.py's parity test:
    pixel set iff (x * 31 + y * 7) % 5 == 0
"""
from __future__ import annotations

from pathlib import Path

from frame_format import HEIGHT, WIDTH, pack_1bpp_msb

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "web" / "src" / "__fixtures__" / "oracle_frame.bin"


def oracle_pattern() -> list[int]:
    return [
        1 if (x * 31 + y * 7) % 5 == 0 else 0
        for y in range(HEIGHT)
        for x in range(WIDTH)
    ]


def main() -> None:
    data = pack_1bpp_msb(oracle_pattern())
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_bytes(data)
    print(f"wrote {FIXTURE}  ({len(data):,} bytes)")


if __name__ == "__main__":
    main()
