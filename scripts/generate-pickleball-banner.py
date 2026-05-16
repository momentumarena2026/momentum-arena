"""Generate the pickleball launch-promo banner image.

Output: public/pickleball-promo-banner.png (2400x800 — 3:1 aspect, retina-ready).

Reproducible: edit constants below and re-run. Re-run is idempotent —
overwrites the file in place. Run from repo root:

    python3 scripts/generate-pickleball-banner.py
"""

from __future__ import annotations

import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ── Output ─────────────────────────────────────────────────────────────────
OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public",
    "pickleball-promo-banner.png",
)
W, H = 2400, 800

# ── Palette (mirrors the dark theme + yellow-500/amber-400 promo accent) ──
BG_TOP = (24, 24, 27)         # zinc-900
BG_BOTTOM = (9, 9, 11)        # zinc-950
AMBER = (250, 204, 21)        # yellow-400
AMBER_DEEP = (245, 158, 11)   # amber-500
AMBER_DARK = (113, 63, 18)    # amber-900 (for soft shadow blocks)
WHITE = (255, 255, 255)
ZINC_100 = (244, 244, 245)
ZINC_300 = (212, 212, 216)
ZINC_400 = (161, 161, 170)
ZINC_900 = (24, 24, 27)
PADDLE_RED = (220, 38, 38)    # red-600 — the paddle face
PADDLE_RED_DARK = (153, 27, 27)  # red-900 — paddle rim
BALL_GREEN = (163, 230, 53)   # lime-400 — wiffle ball


def load_font(candidates: list[tuple[str, int]]) -> ImageFont.FreeTypeFont:
    """Return the first font that loads. Walks candidates in order."""
    last_err: Exception | None = None
    for path, size in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError) as exc:
            last_err = exc
            continue
    raise RuntimeError(f"No usable font from candidates: {last_err}")


# Helvetica.ttc is the macOS standard and ships with weights baked in.
# Fall through to DejaVu / Arial if we ever generate this on Linux CI.
def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """weight ∈ {regular, bold, black}. Sizes are in PX at 2400x800 scale."""
    macos = "/System/Library/Fonts/Helvetica.ttc"
    macos_neue = "/System/Library/Fonts/HelveticaNeue.ttc"
    # ttc index varies by weight on macOS; PIL accepts `:index` via
    # the `index` kwarg, but `truetype` falls back to index=0 if we
    # only pass the path. That's fine — we get the regular face and
    # let PIL emulate bold via the `Image.SOLID` text drawing for
    # heavier weights. The Black look is achieved by drawing the
    # text twice with a 1-2px offset (faux bold) where needed.
    return load_font([(macos_neue, size), (macos, size), ("Arial.ttf", size)])


def draw_vertical_gradient(img: Image.Image, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> None:
    """Fill `img` with a top→bottom gradient between two RGB tuples."""
    base = Image.new("RGB", (1, img.height), 0)
    px = base.load()
    for y in range(img.height):
        t = y / max(1, img.height - 1)
        px[0, y] = (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        )
    img.paste(base.resize((img.width, img.height)), (0, 0))


def draw_radial_glow(img: Image.Image, cx: int, cy: int, radius: int, color: tuple[int, int, int], alpha: int = 90) -> None:
    """Stamp a soft radial color glow centered at (cx, cy)."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*color, alpha))
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=radius // 3))
    img.alpha_composite(overlay)


def draw_paddle_and_ball(img: Image.Image, cx: int, cy: int, scale: float = 1.0) -> None:
    """Draw a stylized pickleball paddle + ball roughly centered at (cx, cy).

    The paddle is a vertical oval angled ~ -20° with a stubby grip;
    the ball is a green wiffle sphere with stipple dots. Keep the
    primitives simple — this is a small accent, not a hero asset.
    """
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # Paddle face — large red ellipse with a darker rim. Rendered on
    # its own RGBA buffer so we can rotate the whole stack and paste
    # cleanly on top of the gradient background.
    p = Image.new("RGBA", (int(380 * scale), int(540 * scale)), (0, 0, 0, 0))
    pd = ImageDraw.Draw(p)
    pad_w, pad_h = int(360 * scale), int(420 * scale)
    pd.ellipse((10, 10, pad_w, pad_h), fill=PADDLE_RED_DARK)
    pd.ellipse((26, 26, pad_w - 16, pad_h - 16), fill=PADDLE_RED)
    # subtle gloss arc on the upper-left — a thin crescent, not a
    # round patch. Two overlapping ellipses subtract to leave just
    # the highlight curve.
    gloss = Image.new("RGBA", (pad_w + 20, pad_h + 20), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.ellipse(
        (40, 50, int(pad_w * 0.62), int(pad_h * 0.42)),
        fill=(254, 226, 226, 110),  # red-100 soft
    )
    gd.ellipse(
        (60, 80, int(pad_w * 0.65), int(pad_h * 0.50)),
        fill=(0, 0, 0, 0),
    )
    # cut the inner ellipse out by drawing it with transparent fill
    # via a mask. PIL doesn't subtract directly, so we re-paint the
    # interior with the paddle face color to leave only the crescent.
    gd.ellipse(
        (62, 82, int(pad_w * 0.66), int(pad_h * 0.51)),
        fill=PADDLE_RED,
    )
    p.alpha_composite(gloss)
    # grip — rounded rectangle hanging off the bottom of the face
    grip_w = int(78 * scale)
    grip_h = int(130 * scale)
    grip_x = (pad_w - grip_w) // 2 + 10
    grip_y = pad_h - 20
    pd.rounded_rectangle(
        (grip_x, grip_y, grip_x + grip_w, grip_y + grip_h),
        radius=int(18 * scale),
        fill=ZINC_900,
        outline=PADDLE_RED_DARK,
        width=int(6 * scale),
    )
    # grip wraps — three dark stripes
    for i in range(3):
        wy = grip_y + int(28 * scale) + i * int(28 * scale)
        pd.line(
            [(grip_x + 8, wy), (grip_x + grip_w - 8, wy)],
            fill=(63, 63, 70),
            width=int(4 * scale),
        )

    p = p.rotate(-22, resample=Image.BICUBIC, expand=True)
    px_off = cx - p.width // 2
    py_off = cy - p.height // 2 + int(20 * scale)
    overlay.alpha_composite(p, (px_off, py_off))

    # Ball — green wiffle sphere with stipple holes
    ball_r = int(95 * scale)
    bx = cx + int(170 * scale)
    by = cy - int(180 * scale)
    d.ellipse(
        (bx - ball_r, by - ball_r, bx + ball_r, by + ball_r),
        fill=BALL_GREEN,
        outline=(101, 163, 13),  # lime-600
        width=int(4 * scale),
    )
    # highlight
    d.ellipse(
        (
            bx - int(ball_r * 0.55),
            by - int(ball_r * 0.7),
            bx + int(ball_r * 0.05),
            by - int(ball_r * 0.15),
        ),
        fill=(217, 249, 157, 180),  # lime-200 soft
    )
    # stipple holes — small dark dots in a sparse grid
    for (ox, oy) in [
        (-40, -10), (-10, -35), (25, -20), (40, 15),
        (10, 35), (-25, 30), (-45, 5), (15, -5),
    ]:
        d.ellipse(
            (bx + ox - 6, by + oy - 6, bx + ox + 6, by + oy + 6),
            fill=(63, 98, 18),  # lime-800
        )

    img.alpha_composite(overlay)


def draw_text_centered_x(draw: ImageDraw.ImageDraw, xy_center: int, y: int, text: str, font_obj: ImageFont.FreeTypeFont, fill, faux_bold: int = 0) -> None:
    """Draw `text` horizontally centered around xy_center at `y`."""
    bbox = draw.textbbox((0, 0), text, font=font_obj)
    tw = bbox[2] - bbox[0]
    x = xy_center - tw // 2
    if faux_bold:
        for dx in range(-faux_bold, faux_bold + 1):
            for dy in range(-faux_bold, faux_bold + 1):
                draw.text((x + dx, y + dy), text, font=font_obj, fill=fill)
    else:
        draw.text((x, y), text, font=font_obj, fill=fill)


def main() -> None:
    img = Image.new("RGB", (W, H), BG_TOP)
    draw_vertical_gradient(img, BG_TOP, BG_BOTTOM)
    img = img.convert("RGBA")

    # ── Soft glows for visual depth ───────────────────────────────────────
    # Amber glow behind the right-side paddle area
    draw_radial_glow(img, cx=int(W * 0.82), cy=int(H * 0.45), radius=620, color=AMBER_DEEP, alpha=70)
    # Cool teal-ish glow on the left to lift the text area without
    # competing with the yellow.
    draw_radial_glow(img, cx=int(W * 0.18), cy=int(H * 0.6), radius=520, color=(20, 184, 166), alpha=35)

    # ── Subtle diagonal stripe behind the right third ─────────────────────
    stripe = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripe)
    for i, alpha in enumerate([18, 28, 18]):
        offset = (i - 1) * 60
        sd.polygon(
            [
                (W * 0.55 + offset, 0),
                (W * 0.70 + offset, 0),
                (W * 0.60 + offset, H),
                (W * 0.45 + offset, H),
            ],
            fill=(*AMBER, alpha),
        )
    img.alpha_composite(stripe)

    # ── Paddle + ball illustration on the right ───────────────────────────
    draw_paddle_and_ball(img, cx=int(W * 0.82), cy=int(H * 0.55), scale=1.05)

    # ── Text block on the left ────────────────────────────────────────────
    d = ImageDraw.Draw(img)

    # Eyebrow pill — solid amber chip with dark text. The earlier
    # transparent-fill + amber-text combo washed the label out at
    # display size, so we go full opacity for legibility.
    eyebrow_text = "PICKLEBALL  ·  LAUNCH  OFFER"
    eyebrow_font = font("bold", 44)
    eyebrow_pad_x, eyebrow_pad_y = 40, 20
    eb_bbox = d.textbbox((0, 0), eyebrow_text, font=eyebrow_font)
    eb_w = eb_bbox[2] - eb_bbox[0]
    eb_h = eb_bbox[3] - eb_bbox[1]
    eb_x, eb_y = 120, 90
    d.rounded_rectangle(
        (eb_x, eb_y, eb_x + eb_w + eyebrow_pad_x * 2, eb_y + eb_h + eyebrow_pad_y * 2 + 6),
        radius=999,
        fill=AMBER,
    )
    # Faux-bold the text via 1px double-stamp so it reads as solid
    # tracked-out caps even on retina downscales.
    for dx in (0, 1):
        d.text(
            (eb_x + eyebrow_pad_x + dx, eb_y + eyebrow_pad_y),
            eyebrow_text,
            font=eyebrow_font,
            fill=ZINC_900,
        )

    # Headline: "25% OFF" — massive
    headline_font = font("black", 320)
    head_x = 120
    head_y = 200
    # Draw filled headline + a small offset for faux-black weight.
    d.text((head_x + 4, head_y), "25% OFF", font=headline_font, fill=AMBER)
    d.text((head_x, head_y), "25% OFF", font=headline_font, fill=AMBER)

    # Subhead: "Flat 25% off every pickleball slot"
    sub_font = font("regular", 56)
    sub_y = head_y + 320
    d.text(
        (head_x + 6, sub_y),
        "Flat 25% off every pickleball slot.",
        font=sub_font,
        fill=ZINC_100,
    )

    # Price row: "Morning ₹600 ₹450/hr   ·   Night ₹800 ₹600/hr"
    price_y = sub_y + 100
    label_font = font("regular", 42)
    price_old_font = font("regular", 42)
    price_new_font = font("bold", 50)
    cursor_x = head_x + 6

    def write_run(text: str, fnt: ImageFont.FreeTypeFont, fill, strike: bool = False) -> int:
        nonlocal cursor_x
        d.text((cursor_x, price_y - (4 if fnt is price_new_font else 0)), text, font=fnt, fill=fill)
        bbox = d.textbbox((0, 0), text, font=fnt)
        w = bbox[2] - bbox[0]
        if strike:
            # Strike-through line across the middle of the text
            mid = price_y + (bbox[3] - bbox[1]) // 2 + 4
            d.line(
                [(cursor_x - 2, mid), (cursor_x + w + 2, mid)],
                fill=ZINC_400,
                width=4,
            )
        cursor_x += w
        return w

    write_run("Morning  ", label_font, ZINC_300)
    write_run("₹600", price_old_font, ZINC_400, strike=True)
    write_run("  ₹450/hr", price_new_font, AMBER)
    write_run("     ·     ", label_font, ZINC_400)
    write_run("Night  ", label_font, ZINC_300)
    write_run("₹800", price_old_font, ZINC_400, strike=True)
    write_run("  ₹600/hr", price_new_font, AMBER)

    # Footer line
    foot_font = font("regular", 32)
    d.text(
        (head_x + 6, H - 80),
        "Auto-applied at checkout. No code needed.",
        font=foot_font,
        fill=ZINC_400,
    )

    # ── Hairline border to lift the banner off any background it lands on
    border = Image.new("RGBA", img.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    bd.rounded_rectangle((4, 4, W - 4, H - 4), radius=40, outline=(63, 63, 70, 180), width=4)
    img.alpha_composite(border)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    img.convert("RGB").save(OUT_PATH, format="PNG", optimize=True)
    print(f"Wrote {OUT_PATH} ({W}x{H})")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
