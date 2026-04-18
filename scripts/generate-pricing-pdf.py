#!/usr/bin/env python3
"""Generate Momentum Arena pricing PDF with dark theme and branding."""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

# ── Colors ──────────────────────────────────────────────────
BG_BLACK = HexColor("#0a0a0a")
BG_ZINC_900 = HexColor("#18181b")
BG_ZINC_800 = HexColor("#27272a")
BG_ZINC_700 = HexColor("#3f3f46")
TEXT_WHITE = HexColor("#fafafa")
TEXT_ZINC_300 = HexColor("#d4d4d8")
TEXT_ZINC_400 = HexColor("#a1a1aa")
TEXT_ZINC_500 = HexColor("#71717a")
EMERALD_500 = HexColor("#10b981")
EMERALD_600 = HexColor("#059669")
EMERALD_400 = HexColor("#34d399")
EMERALD_900_30 = HexColor("#1a3a2a")
AMBER_400 = HexColor("#fbbf24")
AMBER_500 = HexColor("#f59e0b")
BLUE_400 = HexColor("#60a5fa")
PURPLE_400 = HexColor("#c084fc")

# ── Paths ───────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(BASE_DIR, "public", "blackLogo.png")
OUTPUT_PATH = os.path.join(BASE_DIR, "public", "momentum-arena-pricing.pdf")

W, H = A4  # 595.27 x 841.89 points


def draw_rounded_rect(c, x, y, w, h, r, fill_color, stroke_color=None, stroke_width=0.5):
    """Draw a rounded rectangle."""
    c.saveState()
    if stroke_color:
        c.setStrokeColor(stroke_color)
        c.setLineWidth(stroke_width)
    else:
        c.setStrokeColor(fill_color)
    c.setFillColor(fill_color)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1 if stroke_color else 0)
    c.restoreState()


def draw_gradient_bar(c, x, y, w, h, color_left, color_right):
    """Draw a simple gradient bar using strips."""
    steps = 40
    strip_w = w / steps
    for i in range(steps):
        t = i / (steps - 1)
        r = color_left.red + (color_right.red - color_left.red) * t
        g = color_left.green + (color_right.green - color_left.green) * t
        b = color_left.blue + (color_right.blue - color_left.blue) * t
        c.setFillColorRGB(r, g, b)
        c.rect(x + i * strip_w, y, strip_w + 0.5, h, fill=1, stroke=0)


def draw_pricing_table(c, y_start, title, title_icon, title_color, rows, col_widths, x_start):
    """Draw a styled pricing table. Returns y position after table."""
    y = y_start
    total_w = sum(col_widths)

    # Section title with icon
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(title_color)
    c.drawString(x_start, y, title_icon)
    c.drawString(x_start + 22, y, title)
    y -= 8

    # Gradient accent line under title
    draw_gradient_bar(c, x_start, y - 2, total_w, 2.5, title_color, HexColor("#0a0a0a"))
    y -= 18

    # Header row
    header_h = 28
    draw_rounded_rect(c, x_start, y - header_h + 6, total_w, header_h, 6, EMERALD_600)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(TEXT_WHITE)
    headers = ["Configuration", "Dimensions", "Day Price", "Night Price"]
    col_x = x_start + 10
    for i, header in enumerate(headers):
        c.drawString(col_x, y - 12, header)
        col_x += col_widths[i]
    y -= header_h + 4

    # Data rows
    for idx, row in enumerate(rows):
        row_h = 30
        bg = BG_ZINC_900 if idx % 2 == 0 else BG_ZINC_800
        border = BG_ZINC_700 if idx % 2 == 0 else None
        draw_rounded_rect(c, x_start, y - row_h + 8, total_w, row_h, 4, bg, border)

        col_x = x_start + 10
        for i, cell in enumerate(row):
            if i >= 2:  # Price columns
                c.setFont("Helvetica-Bold", 11)
                c.setFillColor(EMERALD_400)
            elif i == 1:  # Dimensions
                c.setFont("Helvetica", 10)
                c.setFillColor(TEXT_ZINC_400)
            else:  # Config name
                c.setFont("Helvetica-Bold", 11)
                c.setFillColor(TEXT_WHITE)
            c.drawString(col_x, y - 11, cell)
            col_x += col_widths[i]
        y -= row_h + 2

    return y


def generate_pdf():
    c = canvas.Canvas(OUTPUT_PATH, pagesize=A4)
    c.setTitle("Momentum Arena - Pricing Guide")
    c.setAuthor("Momentum Arena")
    c.setSubject("Sports Facility Pricing")

    margin = 30
    content_w = W - 2 * margin

    # ════════════════════════════════════════════════════════
    # BACKGROUND
    # ════════════════════════════════════════════════════════
    c.setFillColor(BG_BLACK)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Subtle top gradient accent
    draw_gradient_bar(c, 0, H - 4, W, 4, EMERALD_500, EMERALD_600)

    # ════════════════════════════════════════════════════════
    # LOGO & HEADER
    # ════════════════════════════════════════════════════════
    y = H - 30

    # Logo
    if os.path.exists(LOGO_PATH):
        logo = ImageReader(LOGO_PATH)
        logo_w = 160
        logo_h = 53
        c.drawImage(logo, (W - logo_w) / 2, y - logo_h, width=logo_w, height=logo_h,
                     preserveAspectRatio=True, mask='auto')
        y -= logo_h + 10

    # Tagline
    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_400)
    c.drawCentredString(W / 2, y, "Mathura's Premier Indoor Sports Arena")
    y -= 18

    # Decorative divider
    div_w = 60
    draw_gradient_bar(c, (W - div_w) / 2, y, div_w, 2, EMERALD_400, EMERALD_600)
    y -= 20

    # Main title
    c.setFont("Helvetica-Bold", 26)
    c.setFillColor(TEXT_WHITE)
    c.drawCentredString(W / 2, y, "PRICING GUIDE")
    y -= 18

    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_500)
    c.drawCentredString(W / 2, y, "Same rates on Weekdays & Weekends")
    y -= 28

    # ════════════════════════════════════════════════════════
    # TIME SLOTS BANNER
    # ════════════════════════════════════════════════════════
    banner_h = 48
    banner_w = content_w
    banner_x = margin
    gap = 10
    half_w = (banner_w - gap) / 2

    # Day time card
    draw_rounded_rect(c, banner_x, y - banner_h, half_w, banner_h, 8,
                      HexColor("#1c2820"), EMERALD_600, 1)
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(AMBER_400)
    c.drawCentredString(banner_x + half_w / 2, y - 18, "DAY TIME")
    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_300)
    c.drawCentredString(banner_x + half_w / 2, y - 34, "5:00 AM  -  5:00 PM")

    # Night time card
    night_x = banner_x + half_w + gap
    draw_rounded_rect(c, night_x, y - banner_h, half_w, banner_h, 8,
                      HexColor("#1c1c2e"), PURPLE_400, 1)
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(PURPLE_400)
    c.drawCentredString(night_x + half_w / 2, y - 18, "NIGHT TIME")
    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_300)
    c.drawCentredString(night_x + half_w / 2, y - 34, "5:00 PM  -  12:00 AM")

    y -= banner_h + 25

    # ════════════════════════════════════════════════════════
    # CRICKET PRICING TABLE
    # ════════════════════════════════════════════════════════
    col_widths = [140, 120, 120, 120]
    cricket_rows = [
        ["Medium", "40ft x 90ft", "Rs. 1,000/hr", "Rs. 1,200/hr"],
        ["Large", "60ft x 90ft", "Rs. 1,300/hr", "Rs. 1,500/hr"],
        ["Full Field", "80ft x 90ft", "Rs. 1,600/hr", "Rs. 2,000/hr"],
    ]
    y = draw_pricing_table(c, y, "Cricket", "", EMERALD_400, cricket_rows, col_widths, margin)
    y -= 20

    # ════════════════════════════════════════════════════════
    # FOOTBALL PRICING TABLE
    # ════════════════════════════════════════════════════════
    football_rows = [
        ["Full Field", "80ft x 90ft", "Rs. 1,600/hr", "Rs. 2,000/hr"],
    ]
    y = draw_pricing_table(c, y, "Football", "", BLUE_400, football_rows, col_widths, margin)
    y -= 25

    # ════════════════════════════════════════════════════════
    # PER PERSON PRICING SECTION (illustrative — not a per-person charge)
    # ════════════════════════════════════════════════════════
    section_h = 150
    draw_rounded_rect(c, margin, y - section_h, content_w, section_h, 10,
                      EMERALD_900_30, EMERALD_600, 0.8)

    # Section header
    inner_y = y - 22
    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(EMERALD_400)
    c.drawString(margin + 18, inner_y, "Sample Split Per Player")
    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_400)
    c.drawString(margin + 195, inner_y + 1,
                 "(illustration only; you pay the slot rate, not per player)")
    inner_y -= 8

    # Divider
    c.setStrokeColor(HexColor("#1f4a3a"))
    c.setLineWidth(0.5)
    c.line(margin + 18, inner_y, margin + content_w - 18, inner_y)
    inner_y -= 22

    per_person_data = [
        ("Full Field  (80x90)", "16 players", "Rs. 100 /person/hr", "Rs. 125 /person/hr"),
        ("Large  (60x90)", "12 players", "Rs. 108 /person/hr", "Rs. 125 /person/hr"),
        ("Medium  (40x90)", "8 players", "Rs. 125 /person/hr", "Rs. 150 /person/hr"),
    ]

    for config_name, players, day_price, night_price in per_person_data:
        # Config name
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(TEXT_WHITE)
        c.drawString(margin + 20, inner_y, config_name)

        # Player count
        c.setFont("Helvetica", 9)
        c.setFillColor(TEXT_ZINC_500)
        c.drawString(margin + 175, inner_y, players)

        # Day price
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(AMBER_400)
        c.drawString(margin + 260, inner_y, day_price)

        # Night price
        c.setFillColor(PURPLE_400)
        c.drawString(margin + 400, inner_y, night_price)

        inner_y -= 28

    y -= section_h + 20

    # ════════════════════════════════════════════════════════
    # HIGHLIGHTS / FEATURES ROW
    # ════════════════════════════════════════════════════════
    features = [
        ("Floodlit Turf", EMERALD_400),
        ("Same Rate Daily", AMBER_400),
        ("Book Online 24/7", BLUE_400),
        ("5 AM - 1 AM", PURPLE_400),
    ]
    feat_w = (content_w - 3 * 8) / 4
    feat_h = 36
    for i, (feat_text, feat_color) in enumerate(features):
        fx = margin + i * (feat_w + 8)
        draw_rounded_rect(c, fx, y - feat_h, feat_w, feat_h, 6, BG_ZINC_900, BG_ZINC_700, 0.5)
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(feat_color)
        c.drawCentredString(fx + feat_w / 2, y - 14, feat_text.upper())
        # Small dot accent
        c.setFillColor(feat_color)
        c.circle(fx + feat_w / 2, y - 26, 2, fill=1, stroke=0)

    y -= feat_h + 20

    # ════════════════════════════════════════════════════════
    # PAGE BREAK — T&C + contact footer go on page 2
    # ════════════════════════════════════════════════════════
    # Bottom accent on page 1 before flushing the page.
    draw_gradient_bar(c, 0, 0, W, 3, EMERALD_600, EMERALD_500)
    c.showPage()

    # Redraw background + top/bottom accents on page 2
    c.setFillColor(BG_BLACK)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    draw_gradient_bar(c, 0, H - 4, W, 4, EMERALD_500, EMERALD_600)
    draw_gradient_bar(c, 0, 0, W, 3, EMERALD_600, EMERALD_500)

    # Page 2 header strip so it doesn't feel orphaned
    p2y = H - 40
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(TEXT_WHITE)
    c.drawCentredString(W / 2, p2y, "MOMENTUM ARENA")
    p2y -= 14
    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_500)
    c.drawCentredString(W / 2, p2y, "Policies & Contact")
    p2y -= 20
    draw_gradient_bar(c, (W - 60) / 2, p2y, 60, 2, EMERALD_400, EMERALD_600)
    p2y -= 20

    y = p2y

    # ════════════════════════════════════════════════════════
    # TERMS & CONDITIONS
    # ════════════════════════════════════════════════════════
    tnc_items = [
        "Prices are per 1-hour slot, inclusive of applicable taxes, and may change without prior notice. Always refer to live prices on momentumarena.com at time of booking.",
        "Slot booking is subject to real-time availability. Advance payment (typically 50%, at admin discretion) confirms the booking; the remainder is due in cash or UPI at the venue before the slot begins.",
        "Cancellations within 24 hours of the slot are non-refundable. Earlier cancellations may be rescheduled subject to availability.",
        "The venue may cancel or reschedule slots due to weather, equipment issues, or maintenance; full credit is issued in such cases.",
        "Cricket slots include stumps, bats, and a ball. For other sports please bring your own gear.",
        "Children under 12 must be accompanied by a guardian on the court. The venue is not responsible for personal belongings.",
        "By booking a slot, the customer agrees to the full policy published on momentumarena.com.",
    ]

    tnc_h = 14 + len(tnc_items) * 22 + 12
    draw_rounded_rect(c, margin, y - tnc_h, content_w, tnc_h, 10,
                      BG_ZINC_900, BG_ZINC_800, 0.5)

    ty = y - 18
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(EMERALD_400)
    c.drawString(margin + 18, ty, "Terms & Conditions")
    ty -= 14

    # Wrap helper — reportlab has no soft wrap on drawString, so break lines
    # manually using stringWidth at 9pt.
    def wrap_line(text, font, size, max_w):
        words = text.split()
        lines = []
        current = ""
        for w in words:
            trial = (current + " " + w).strip()
            if c.stringWidth(trial, font, size) <= max_w:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = w
        if current:
            lines.append(current)
        return lines

    max_text_w = content_w - 42
    c.setFont("Helvetica", 8.5)
    for item in tnc_items:
        c.setFillColor(EMERALD_400)
        c.drawString(margin + 20, ty, "•")
        c.setFillColor(TEXT_ZINC_300)
        lines = wrap_line(item, "Helvetica", 8.5, max_text_w)
        for i, line in enumerate(lines):
            c.drawString(margin + 32, ty - i * 10, line)
        ty -= max(11, 11 * len(lines))

    y -= tnc_h + 18

    # ════════════════════════════════════════════════════════
    # CONTACT & LOCATION FOOTER
    # ════════════════════════════════════════════════════════
    footer_h = 120
    draw_rounded_rect(c, margin, y - footer_h, content_w, footer_h, 10, BG_ZINC_900, BG_ZINC_800, 0.5)

    fy = y - 20
    # Title
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(EMERALD_400)
    c.drawString(margin + 18, fy, "Get In Touch")
    c.setFont("Helvetica", 12)
    c.setFillColor(TEXT_ZINC_400)
    c.drawRightString(margin + content_w - 18, fy, "momentumarena.com")
    fy -= 6

    # Divider
    c.setStrokeColor(BG_ZINC_700)
    c.setLineWidth(0.5)
    c.line(margin + 18, fy, margin + content_w - 18, fy)
    fy -= 18

    # Two column layout
    left_x = margin + 20
    right_x = margin + content_w / 2 + 10

    # Left column — contact
    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_500)
    c.drawString(left_x, fy, "PHONE / WHATSAPP")
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(TEXT_WHITE)
    c.drawString(left_x + 115, fy, "+91 6396 177 261")
    fy -= 16

    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_500)
    c.drawString(left_x, fy, "EMAIL")
    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_300)
    c.drawString(left_x + 115, fy, "momentumarena2026@gmail.com")
    fy -= 16

    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_500)
    c.drawString(left_x, fy, "SOCIAL")
    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_300)
    c.drawString(left_x + 115, fy, "@momentumarena_  (Instagram & YouTube)")

    # Right column — location
    fy_r = y - 44
    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_500)
    c.drawString(right_x, fy_r, "LOCATION")
    c.setFont("Helvetica", 10)
    c.setFillColor(TEXT_ZINC_300)
    c.drawString(right_x + 70, fy_r, "Khasra No. 293/5, Mouja Ganeshra")
    fy_r -= 16
    c.drawString(right_x + 70, fy_r, "Radhapuram Road, Mathura")
    fy_r -= 16

    c.setFont("Helvetica", 9)
    c.setFillColor(TEXT_ZINC_500)
    c.drawString(right_x, fy_r, "HOURS")
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(EMERALD_400)
    c.drawString(right_x + 70, fy_r, "5:00 AM - 1:00 AM  (Open Daily)")

    # Bottom accent bar
    draw_gradient_bar(c, 0, 0, W, 3, EMERALD_600, EMERALD_500)

    # ════════════════════════════════════════════════════════
    # SAVE
    # ════════════════════════════════════════════════════════
    c.save()
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    generate_pdf()
