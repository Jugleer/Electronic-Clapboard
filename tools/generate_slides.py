"""
Generate 5 original 800x480 1-bit images for the e-paper demo reel,
and emit a single C++ header with PROGMEM byte arrays.

The byte format matches GxEPD2 / Adafruit-GFX drawBitmap() expectations:
    - 1 bit per pixel, 8 pixels per byte, MSB first within each byte
    - Rows packed into ceil(width/8) bytes, scanlines top-to-bottom
    - Logical: 1 = ink (black), 0 = paper (white)
    - drawInvertedBitmap() inverts the sense at draw time, so we generate
      with `1 = black` and call drawInvertedBitmap() OR vice versa.
      We choose: `1 = black` and use display.drawInvertedBitmap().
      (Adafruit GFX drawBitmap historically treats 1=foreground=black on
      mono displays anyway — but GxEPD2 inverts it, hence the 'Inverted' call.)

Output: include/slides_artwork.h
"""
from __future__ import annotations

import math
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_HEADER = ROOT / "include" / "slides_artwork.h"
PREVIEW_DIR = ROOT / "tools" / "preview"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

W, H = 800, 480


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _try_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates_bold = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/calibrib.ttf",
    ]
    candidates_regular = [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/calibri.ttf",
    ]
    for path in (candidates_bold if bold else candidates_regular):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _new_canvas() -> Image.Image:
    return Image.new("L", (W, H), 255)  # white


def _to_1bit_dithered(img: Image.Image) -> Image.Image:
    """Floyd-Steinberg dither L -> 1-bit."""
    return img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)


def _to_1bit_threshold(img: Image.Image, threshold: int = 128) -> Image.Image:
    return img.point(lambda p: 0 if p < threshold else 255).convert("1")


def _draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int,
                   font: ImageFont.ImageFont, fill: int = 0) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2 - bbox[0], y), text, font=font, fill=fill)


# ---------------------------------------------------------------------------
# Slide 1: stylised self-portrait of the assistant
# A friendly robot/Claude-like figure on a starfield, with wires connecting
# to a film slate. Pixel-art aesthetic, dithered shading.
# ---------------------------------------------------------------------------

def slide_self_portrait() -> Image.Image:
    img = _new_canvas()
    d = ImageDraw.Draw(img)

    # --- Starfield background (random dots, weighted toward edges) ---
    rng = random.Random(42)
    for _ in range(900):
        x = rng.randint(0, W - 1)
        y = rng.randint(0, H - 1)
        # Skip area where the robot will be
        if 230 < x < 570 and 60 < y < 430:
            continue
        size = rng.choice([1, 1, 1, 2])
        shade = rng.randint(40, 200)
        d.rectangle([x, y, x + size, y + size], fill=shade)

    # A few "constellation" lines
    constellations = [
        [(60, 80), (110, 60), (140, 110), (90, 140)],
        [(700, 380), (740, 350), (770, 400), (720, 430)],
    ]
    for pts in constellations:
        for a, b in zip(pts, pts[1:]):
            d.line([a, b], fill=120, width=1)
        for p in pts:
            d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=0)

    # --- Robot body ---
    cx = W // 2
    body_top = 130
    body_bot = 380
    body_l = cx - 110
    body_r = cx + 110

    # Torso (rounded rect via two rects + ellipses)
    d.rounded_rectangle([body_l, body_top, body_r, body_bot], radius=24,
                        outline=0, width=4, fill=235)

    # Inner panel
    d.rounded_rectangle([body_l + 18, body_top + 18, body_r - 18, body_bot - 18],
                        radius=14, outline=0, width=2, fill=255)

    # Chest "screen" - tiny clapboard icon
    sx, sy, sw, sh = cx - 70, body_top + 50, 140, 90
    d.rectangle([sx, sy, sx + sw, sy + sh], outline=0, width=3, fill=255)
    # Diagonal stripes on a narrow band
    band_h = 22
    for i in range(-2, 12):
        x0 = sx + i * 18
        d.polygon([(x0, sy), (x0 + 10, sy),
                   (x0 + 10 + band_h, sy + band_h), (x0 + band_h, sy + band_h)],
                  fill=0)
    d.line([sx, sy + band_h, sx + sw, sy + band_h], fill=0, width=2)
    # Lines representing scene/take
    for i, label_y in enumerate([sy + band_h + 16, sy + band_h + 36, sy + band_h + 56]):
        d.line([sx + 12, label_y, sx + 50, label_y], fill=0, width=2)
        d.line([sx + 60, label_y, sx + sw - 12, label_y], fill=80, width=2)

    # Status LEDs row at bottom of torso
    led_y = body_bot - 28
    for i, fill in enumerate([0, 100, 0, 200, 0]):
        d.ellipse([cx - 60 + i * 28, led_y, cx - 44 + i * 28, led_y + 16],
                  outline=0, width=2, fill=fill)

    # --- Head ---
    head_top = 40
    head_bot = body_top - 8
    head_l = cx - 90
    head_r = cx + 90
    d.rounded_rectangle([head_l, head_top, head_r, head_bot], radius=20,
                        outline=0, width=4, fill=245)

    # Antenna
    d.line([cx, head_top, cx, head_top - 30], fill=0, width=3)
    d.ellipse([cx - 8, head_top - 42, cx + 8, head_top - 26], fill=0)
    # Antenna sparkle
    d.line([cx + 14, head_top - 38, cx + 24, head_top - 48], fill=0, width=2)
    d.line([cx + 18, head_top - 32, cx + 28, head_top - 32], fill=0, width=2)

    # Eyes - friendly squinty crescents
    eye_y = head_top + 38
    for ex in [cx - 38, cx + 38]:
        # Eye socket
        d.ellipse([ex - 22, eye_y - 14, ex + 22, eye_y + 14], fill=0)
        # Crescent highlight (smile-shaped pupil cut)
        d.chord([ex - 18, eye_y - 12, ex + 18, eye_y + 12],
                start=200, end=340, fill=255)

    # Mouth - subtle smile
    mouth_y = head_top + 78
    d.arc([cx - 30, mouth_y - 8, cx + 30, mouth_y + 18],
          start=20, end=160, fill=0, width=3)

    # Cheek shading dots
    for cx_off in [-58, 58]:
        for dy in range(0, 6):
            d.point((cx + cx_off + dy, head_top + 60 + dy), fill=80)

    # --- Arms reaching toward a tiny slate ---
    # Left arm
    d.line([body_l + 4, body_top + 80, body_l - 60, body_top + 130],
           fill=0, width=6)
    d.line([body_l - 60, body_top + 130, body_l - 90, body_top + 200],
           fill=0, width=6)
    # Hand (small circle holding slate corner)
    d.ellipse([body_l - 110, body_top + 188, body_l - 70, body_top + 228],
              outline=0, width=3, fill=235)

    # Right arm waving
    d.line([body_r - 4, body_top + 80, body_r + 70, body_top + 50],
           fill=0, width=6)
    d.line([body_r + 70, body_top + 50, body_r + 110, body_top - 10],
           fill=0, width=6)
    d.ellipse([body_r + 100, body_top - 30, body_r + 140, body_top + 10],
              outline=0, width=3, fill=235)
    # Wave motion lines
    for i in range(3):
        d.arc([body_r + 100 + i * 14, body_top - 60 - i * 8,
               body_r + 160 + i * 14, body_top + i * 4],
              start=200, end=340, fill=0, width=2)

    # --- Legs ---
    for lx in [cx - 50, cx + 30]:
        d.rectangle([lx, body_bot, lx + 24, body_bot + 50], outline=0, width=3, fill=235)
        d.rounded_rectangle([lx - 8, body_bot + 46, lx + 32, body_bot + 64],
                            radius=8, outline=0, width=3, fill=200)

    # --- Tiny slate held in left hand ---
    sl_x = body_l - 108
    sl_y = body_top + 220
    d.rectangle([sl_x, sl_y, sl_x + 80, sl_y + 60], outline=0, width=3, fill=255)
    for i in range(-1, 6):
        x0 = sl_x + i * 14
        d.polygon([(x0, sl_y), (x0 + 8, sl_y),
                   (x0 + 8 + 14, sl_y + 14), (x0 + 14, sl_y + 14)],
                  fill=0)
    d.line([sl_x + 8, sl_y + 30, sl_x + 72, sl_y + 30], fill=0, width=1)
    d.line([sl_x + 8, sl_y + 44, sl_x + 72, sl_y + 44], fill=0, width=1)

    # --- Caption ---
    title_font = _try_font(40, bold=True)
    sub_font = _try_font(20, bold=False)
    _draw_centered(d, "yours truly", H - 70, title_font, fill=0)
    _draw_centered(d, "(an artist's impression)", H - 30, sub_font, fill=80)

    return _to_1bit_dithered(img)


# ---------------------------------------------------------------------------
# Slide 2: vintage film camera silhouette with reels spinning
# ---------------------------------------------------------------------------

def slide_film_camera() -> Image.Image:
    """Solid black silhouette of a film camera on plain white. No greys."""
    img = _new_canvas()
    d = ImageDraw.Draw(img)

    # Camera body, shifted slightly left of centre to balance the lens
    cx, cy = W // 2 - 30, H // 2 + 30
    body = [cx - 170, cy - 60, cx + 70, cy + 90]
    d.rounded_rectangle(body, radius=10, fill=0)

    # Lens
    lens_cx = body[2] + 70
    lens_cy = (body[1] + body[3]) // 2
    # Outer barrel
    d.ellipse([lens_cx - 70, lens_cy - 70, lens_cx + 70, lens_cy + 70], fill=0)
    # Glass element (white ring)
    d.ellipse([lens_cx - 50, lens_cy - 50, lens_cx + 50, lens_cy + 50], fill=255)
    # Inner element
    d.ellipse([lens_cx - 32, lens_cy - 32, lens_cx + 32, lens_cy + 32], fill=0)
    # Bright reflection
    d.ellipse([lens_cx - 14, lens_cy - 14, lens_cx + 14, lens_cy + 14], fill=255)
    # Catchlight
    d.ellipse([lens_cx - 10, lens_cy - 18, lens_cx - 2, lens_cy - 10], fill=0)

    # Lens hood (matte rectangle in front of lens)
    hood_x0 = lens_cx + 70
    hood_y0 = lens_cy - 80
    hood_y1 = lens_cy + 80
    d.polygon([(hood_x0, lens_cy - 60), (hood_x0 + 30, hood_y0),
               (hood_x0 + 30, hood_y1), (hood_x0, lens_cy + 60)], fill=0)

    # Two reels on top
    reel_y = body[1] - 50
    for reel_cx in [body[0] + 60, body[2] - 30]:
        # Outer disc
        d.ellipse([reel_cx - 60, reel_y - 60, reel_cx + 60, reel_y + 60], fill=0)
        # White spoke gaps
        for ang in range(0, 360, 60):
            r1 = math.radians(ang - 8)
            r2 = math.radians(ang + 8)
            pts = [
                (reel_cx + int(20 * math.cos(r1)), reel_y + int(20 * math.sin(r1))),
                (reel_cx + int(54 * math.cos(r1)), reel_y + int(54 * math.sin(r1))),
                (reel_cx + int(54 * math.cos(r2)), reel_y + int(54 * math.sin(r2))),
                (reel_cx + int(20 * math.cos(r2)), reel_y + int(20 * math.sin(r2))),
            ]
            d.polygon(pts, fill=255)
        # White outer rim ring
        d.ellipse([reel_cx - 60, reel_y - 60, reel_cx + 60, reel_y + 60],
                  outline=255, width=4)
        # Black hub
        d.ellipse([reel_cx - 16, reel_y - 16, reel_cx + 16, reel_y + 16], fill=0)
        # White centre dot
        d.ellipse([reel_cx - 4, reel_y - 4, reel_cx + 4, reel_y + 4], fill=255)
        # Bridge from reel to body
        d.rectangle([reel_cx - 6, reel_y + 50, reel_cx + 6, body[1]], fill=0)

    # Tripod legs (solid black)
    leg_top_y = body[3]
    leg_top_x = (body[0] + body[2]) // 2 - 20
    d.line([leg_top_x, leg_top_y, leg_top_x - 90, H - 30], fill=0, width=10)
    d.line([leg_top_x + 40, leg_top_y, leg_top_x + 40, H - 30], fill=0, width=10)
    d.line([leg_top_x + 80, leg_top_y, leg_top_x + 170, H - 30], fill=0, width=10)
    # Foot caps
    for fx in [leg_top_x - 90, leg_top_x + 40, leg_top_x + 170]:
        d.ellipse([fx - 10, H - 38, fx + 10, H - 22], fill=0)

    # Operator's viewfinder
    d.rectangle([body[0] - 30, body[1] + 20, body[0], body[1] + 60], fill=0)
    d.rectangle([body[0] - 38, body[1] + 26, body[0] - 30, body[1] + 54], fill=0)

    # Titles (solid black, both at top to keep clear of tripod feet)
    title_font = _try_font(54, bold=True)
    sub_font = _try_font(22, bold=True)
    _draw_centered(d, "LIGHTS. CAMERA.", 24, title_font, fill=0)
    _draw_centered(d, "AND A LITTLE ELECTRONICS.", 90, sub_font, fill=0)

    # Skip dithering — image is already pure black/white
    return _to_1bit_threshold(img, threshold=128)


# ---------------------------------------------------------------------------
# Slide 3: portrait of an actual clapperboard, hyper-detailed
# ---------------------------------------------------------------------------

def slide_clapper_hero() -> Image.Image:
    """Pure black slate on plain white. Solid white stripes/text — no greys."""
    img = _new_canvas()  # plain white
    d = ImageDraw.Draw(img)

    # Slate body, slightly tilted
    body = [(110, 200), (720, 160), (740, 450), (130, 470)]
    d.polygon(body, fill=0)

    # Top stripe band (the part that claps) — sits along the top of the body
    band = [(100, 110), (720, 70), (740, 180), (120, 220)]
    d.polygon(band, fill=255)  # white base
    # Black diagonal stripes on the band
    stripe_count = 12
    for i in range(stripe_count):
        if i % 2 == 0:
            t0 = i / stripe_count
            t1 = (i + 1) / stripe_count
            x0_top = band[0][0] + (band[1][0] - band[0][0]) * t0
            y0_top = band[0][1] + (band[1][1] - band[0][1]) * t0
            x1_top = band[0][0] + (band[1][0] - band[0][0]) * t1
            y1_top = band[0][1] + (band[1][1] - band[0][1]) * t1
            x0_bot = band[3][0] + (band[2][0] - band[3][0]) * t0
            y0_bot = band[3][1] + (band[2][1] - band[3][1]) * t0
            x1_bot = band[3][0] + (band[2][0] - band[3][0]) * t1
            y1_bot = band[3][1] + (band[2][1] - band[3][1]) * t1
            d.polygon([(x0_top, y0_top), (x1_top, y1_top),
                       (x1_bot, y1_bot), (x0_bot, y0_bot)], fill=0)
    # Black border on band
    d.line([band[0], band[1]], fill=0, width=4)
    d.line([band[1], band[2]], fill=0, width=4)
    d.line([band[2], band[3]], fill=0, width=4)
    d.line([band[3], band[0]], fill=0, width=4)

    # Slate text fields — solid white on solid black
    field_font = _try_font(28, bold=True)
    label_font = _try_font(18, bold=True)

    rows = [
        ("PROD.",  "E-CLAPBOARD"),
        ("SCENE",  "01A"),
        ("TAKE",   "001"),
        ("ROLL",   "R-001"),
        ("DATE",   "2026-04-26"),
    ]
    base_x = 150
    base_y = 245
    line_h = 38
    for i, (lab, val) in enumerate(rows):
        y = base_y + i * line_h
        d.text((base_x, y + 4), lab, font=label_font, fill=255)
        d.line([base_x + 90, y + 32, base_x + 380, y + 32], fill=255, width=2)
        d.text((base_x + 100, y), val, font=field_font, fill=255)

    # Director / camera column on the right
    col_x = 540
    d.text((col_x, base_y + 4), "DIRECTOR", font=label_font, fill=255)
    d.text((col_x, base_y + 28), "YOU", font=field_font, fill=255)
    d.line([col_x, base_y + 70, col_x + 130, base_y + 70], fill=255, width=2)
    d.text((col_x, base_y + 80), "CAMERA", font=label_font, fill=255)
    d.text((col_x, base_y + 104), "A", font=field_font, fill=255)

    # Hinge pivot at top-left where the band meets the body
    d.ellipse([90, 135, 130, 175], fill=0)
    d.ellipse([100, 145, 120, 165], fill=255)

    # Pure black/white only — no dither needed
    return _to_1bit_threshold(img, threshold=128)


# ---------------------------------------------------------------------------
# Slide 4: starry night with a film reel moon
# ---------------------------------------------------------------------------

def slide_reel_moon() -> Image.Image:
    img = Image.new("L", (W, H), 30)  # very dark background
    d = ImageDraw.Draw(img)

    # Stars
    rng = random.Random(7)
    for _ in range(700):
        x = rng.randint(0, W - 1)
        y = rng.randint(0, H - 1)
        if (x - 600) ** 2 + (y - 170) ** 2 < 130 ** 2:
            continue  # leave moon area dark
        shade = rng.choice([180, 200, 220, 255, 255])
        d.point((x, y), fill=shade)

    # Some bigger stars with cross-glints
    for _ in range(12):
        x = rng.randint(20, W - 20)
        y = rng.randint(20, H - 220)
        if (x - 600) ** 2 + (y - 170) ** 2 < 150 ** 2:
            continue
        d.line([x - 5, y, x + 5, y], fill=255, width=1)
        d.line([x, y - 5, x, y + 5], fill=255, width=1)
        d.point((x, y), fill=255)

    # Moon as a film reel
    mx, my, mr = 600, 170, 110
    d.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=240)
    d.ellipse([mx - mr, my - mr, mx + mr, my + mr], outline=200, width=4)
    # Spokes
    for ang in range(0, 360, 45):
        r = math.radians(ang)
        x1 = mx + int(20 * math.cos(r))
        y1 = my + int(20 * math.sin(r))
        x2 = mx + int((mr - 12) * math.cos(r))
        y2 = my + int((mr - 12) * math.sin(r))
        d.line([x1, y1, x2, y2], fill=80, width=10)
    d.ellipse([mx - 22, my - 22, mx + 22, my + 22], fill=30)

    # Mountainous horizon
    horizon = H - 110
    d.polygon([(0, horizon), (120, horizon - 80), (220, horizon - 30),
               (340, horizon - 100), (470, horizon - 50),
               (600, horizon - 110), (740, horizon - 60), (W, horizon - 80),
               (W, H), (0, H)], fill=10)

    # A trailing strip of "film" curling from the moon
    for i in range(0, 360, 8):
        t = i / 360
        x = int(mx - mr + (mx - 100) * (1 - math.cos(t * math.pi)))
        y = int(my + mr + 60 * math.sin(t * math.pi * 2))
        d.rectangle([x, y, x + 30, y + 4], fill=200)
        # Sprocket holes
        d.rectangle([x + 6, y + 1, x + 9, y + 3], fill=10)
        d.rectangle([x + 20, y + 1, x + 23, y + 3], fill=10)

    # Title
    title_font = _try_font(46, bold=True)
    sub_font = _try_font(20, bold=False)
    _draw_centered(d, "DREAM IN 24 FPS", 36, title_font, fill=240)
    _draw_centered(d, "wake up. roll camera.", H - 44, sub_font, fill=200)

    return _to_1bit_dithered(img)


# ---------------------------------------------------------------------------
# Slide 5: schematic-style "you are here" - PCB traces forming a clapperboard
# ---------------------------------------------------------------------------

def slide_pcb() -> Image.Image:
    img = _new_canvas()
    d = ImageDraw.Draw(img)

    # Faint dotted grid (will dither out)
    for x in range(0, W, 20):
        for y in range(0, H, 20):
            d.point((x, y), fill=200)

    # Outer board outline
    d.rectangle([20, 20, W - 20, H - 20], outline=0, width=4)
    # Mounting holes
    for cx, cy in [(40, 40), (W - 40, 40), (40, H - 40), (W - 40, H - 40)]:
        d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], outline=0, width=3, fill=255)
        d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=0)

    # IC at centre with 'ESP32-S3' label
    ic_x0, ic_y0, ic_x1, ic_y1 = W // 2 - 110, H // 2 - 60, W // 2 + 110, H // 2 + 60
    d.rectangle([ic_x0, ic_y0, ic_x1, ic_y1], outline=0, width=3, fill=40)
    d.ellipse([ic_x0 + 12, ic_y0 + 12, ic_x0 + 22, ic_y0 + 22], outline=240, width=2)

    # IC pins
    for i in range(12):
        # Top
        d.rectangle([ic_x0 + 14 + i * 16, ic_y0 - 10,
                     ic_x0 + 24 + i * 16, ic_y0], fill=0)
        # Bottom
        d.rectangle([ic_x0 + 14 + i * 16, ic_y1,
                     ic_x0 + 24 + i * 16, ic_y1 + 10], fill=0)
    for i in range(7):
        # Left
        d.rectangle([ic_x0 - 10, ic_y0 + 14 + i * 16,
                     ic_x0, ic_y0 + 24 + i * 16], fill=0)
        # Right
        d.rectangle([ic_x1, ic_y0 + 14 + i * 16,
                     ic_x1 + 10, ic_y0 + 24 + i * 16], fill=0)

    label_font = _try_font(22, bold=True)
    d.text((ic_x0 + 30, ic_y0 + 20), "ESP32-S3", font=label_font, fill=240)
    small = _try_font(14, bold=False)
    d.text((ic_x0 + 30, ic_y0 + 60), "the brain", font=small, fill=200)
    d.text((ic_x0 + 30, ic_y0 + 80), "240 MHz", font=small, fill=200)

    # Traces fanning out to peripherals
    def draw_trace(points, label_pos=None, label_text=None):
        for a, b in zip(points, points[1:]):
            d.line([a, b], fill=0, width=3)
        # Pad at endpoint
        ex, ey = points[-1]
        d.ellipse([ex - 10, ey - 10, ex + 10, ey + 10], outline=0, width=3, fill=255)
        d.ellipse([ex - 3, ey - 3, ex + 3, ey + 3], fill=0)
        if label_text:
            d.text(label_pos, label_text, font=small, fill=0)

    # E-paper trace (top-right)
    draw_trace([(ic_x1, ic_y0 + 30), (W - 100, ic_y0 + 30),
                (W - 100, 80), (W - 60, 80)],
               (W - 220, 60), "EPD")

    # LED trace (top-left)
    draw_trace([(ic_x0, ic_y0 + 30), (ic_x0 - 80, ic_y0 + 30),
                (ic_x0 - 80, 80), (60, 80)],
               (90, 60), "LED")
    # LED schematic symbol at the pad
    d.line([60, 80, 80, 60], fill=0, width=2)
    d.line([60, 80, 80, 100], fill=0, width=2)
    d.line([80, 60, 80, 100], fill=0, width=2)

    # Solenoid trace (bottom-left)
    draw_trace([(ic_x0, ic_y1 - 30), (ic_x0 - 100, ic_y1 - 30),
                (ic_x0 - 100, H - 80), (80, H - 80)],
               (50, H - 110), "SOL")
    # Coil symbol (loops)
    for i in range(4):
        d.arc([60 + i * 18, H - 90, 78 + i * 18, H - 70],
              start=0, end=180, fill=0, width=2)

    # Battery trace (bottom-right)
    draw_trace([(ic_x1, ic_y1 - 30), (ic_x1 + 100, ic_y1 - 30),
                (ic_x1 + 100, H - 80), (W - 80, H - 80)],
               (W - 200, H - 110), "VBAT")
    # Battery symbol
    d.line([W - 80, H - 90, W - 80, H - 70], fill=0, width=4)
    d.line([W - 70, H - 95, W - 70, H - 65], fill=0, width=2)

    # Title strip
    title_font = _try_font(36, bold=True)
    _draw_centered(d, "you are here", 26, title_font, fill=0)

    return _to_1bit_threshold(img, threshold=140)


# ---------------------------------------------------------------------------
# Encoding to 1bpp MSB-first
# ---------------------------------------------------------------------------

def encode_1bpp_msb(img: Image.Image) -> bytes:
    """Convert a PIL '1' image to 1bpp MSB-first packed bytes,
    where 1 = ink (black). PIL's '1' mode stores 0=black,255=white,
    so we invert at packing time.

    NOT the wire-format encoder for POST /frame. This function pairs
    with `display.drawInvertedBitmap()` in the legacy PROGMEM-header
    pipeline that feeds [env:esp32s3]'s typewriter demo — its inversion
    cancels the driver's. The /frame data plane uses
    `display.drawBitmap()` directly and expects bytes packed straight
    per docs/protocol.md §1. For anything heading to the wire, use
    `tools/frame_format.py:pack_1bpp_msb` (or the JS mirror at
    `web/src/frameFormat.ts`); see `tools/dump_slide.py` for an example
    of re-using slide artwork through the wire-spec encoder. Phase 2
    implementation note 11 in `docs/phased-build-plan.md` has the
    full backstory."""
    assert img.mode == "1"
    assert img.size == (W, H)
    px = img.load()
    out = bytearray()
    for y in range(H):
        byte = 0
        bits = 0
        for x in range(W):
            v = 1 if px[x, y] == 0 else 0  # 1 = black ink
            byte = (byte << 1) | v
            bits += 1
            if bits == 8:
                out.append(byte)
                byte = 0
                bits = 0
        if bits:
            out.append(byte << (8 - bits))
    return bytes(out)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    slides = [
        ("self_portrait", "self-portrait of the artist", slide_self_portrait),
        ("film_camera",   "lights, camera, electronics", slide_film_camera),
        ("clapper_hero",  "the slate, hero-shot",        slide_clapper_hero),
        ("reel_moon",     "dream in 24 fps",             slide_reel_moon),
        ("pcb",           "you are here",                slide_pcb),
    ]

    parts: list[str] = []
    parts.append("// AUTO-GENERATED by tools/generate_slides.py — do not edit by hand.\n")
    parts.append("// 1bpp MSB-first, 800x480, 1 = black ink.\n")
    parts.append("// Use display.drawInvertedBitmap(0, 0, data, 800, 480, GxEPD_BLACK).\n")
    parts.append("#pragma once\n")
    parts.append("#include <pgmspace.h>\n")
    parts.append("#include <stdint.h>\n\n")
    parts.append("constexpr int16_t SLIDE_W = 800;\n")
    parts.append("constexpr int16_t SLIDE_H = 480;\n\n")

    for name, caption, fn in slides:
        print(f"rendering: {name}")
        img = fn()
        # Save preview PNG
        img.save(PREVIEW_DIR / f"{name}.png")
        data = encode_1bpp_msb(img)
        assert len(data) == (W // 8) * H, f"unexpected length {len(data)}"

        parts.append(f"// {caption}\n")
        parts.append(
            f"const uint8_t SLIDE_{name.upper()}_DATA[{len(data)}] PROGMEM = {{\n"
        )
        per_row = 16
        for i in range(0, len(data), per_row):
            chunk = data[i:i + per_row]
            parts.append("    " + ", ".join(f"0x{b:02X}" for b in chunk) + ",\n")
        parts.append("};\n\n")

    # Captions table
    parts.append("struct SlideEntry {\n")
    parts.append("    const char* name;\n")
    parts.append("    const char* caption;\n")
    parts.append("    const uint8_t* data;\n")
    parts.append("};\n\n")
    parts.append("constexpr size_t SLIDE_COUNT = " + str(len(slides)) + ";\n")
    parts.append("inline const SlideEntry SLIDES[SLIDE_COUNT] = {\n")
    for name, caption, _ in slides:
        parts.append(f'    {{ "{name}", "{caption}", SLIDE_{name.upper()}_DATA }},\n')
    parts.append("};\n")

    OUT_HEADER.write_text("".join(parts), encoding="utf-8")
    print(f"wrote {OUT_HEADER}  ({OUT_HEADER.stat().st_size:,} bytes)")
    print(f"previews in {PREVIEW_DIR}")


if __name__ == "__main__":
    main()
