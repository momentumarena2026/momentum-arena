#!/usr/bin/env python3
"""Generate the Momentum Arena Feature Guide PDF.

v2.0 (July 2026) — complete rewrite reflecting the shipped system:
web + iOS + Android customer apps, PhonePe DQR / UPI-intent payments,
rewards, waitlist, recurring, cafe, shop, push templates, full admin
suite, OTA pipeline. Every major feature carries a flowchart.

Run:  python3 generate-feature-guide.py
Writes Momentum-Arena-Feature-Guide.pdf next to this script.
"""

import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Flowable, KeepTogether,
)

# ── Brand colors ────────────────────────────────────────────────────
EMERALD = HexColor("#10b981")
EMERALD_DARK = HexColor("#065f46")
EMERALD_TINT = HexColor("#d1fae5")
AMBER = HexColor("#f59e0b")
AMBER_TINT = HexColor("#fef3c7")
ZINC_700 = HexColor("#3f3f46")
ZINC_500 = HexColor("#71717a")
ZINC_400 = HexColor("#a1a1aa")
ZINC_200 = HexColor("#e4e4e7")
BLUE = HexColor("#3b82f6")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
FRAME_W = PAGE_W - 2 * MARGIN

VERSION = "Version 2.0 | July 2026"


# ── Flowchart flowable ──────────────────────────────────────────────
# rows: list of rows; each row is a list of nodes.
# node = (text, kind) or (text, kind, edge_label)
#   kind: "start" | "step" | "decision" | "end"
#   edge_label: label on the arrow ENTERING this node (e.g. "Yes")
class FlowChart(Flowable):
    FONT = "Helvetica"
    FSIZE = 7.5
    PAD_X = 4
    PAD_Y = 3.5
    ROW_GAP = 8 * mm
    NODE_GAP = 6 * mm
    LEAD = 9

    def __init__(self, rows, width=FRAME_W):
        super().__init__()
        self.rows = [
            [(n + ("",))[:3] if len(n) < 3 else n for n in row]
            for row in rows
        ]
        self.width = width
        self._layout()

    def _wrap(self, text, max_w):
        words, lines, cur = text.split(), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if stringWidth(trial, self.FONT, self.FSIZE) <= max_w - 2 * self.PAD_X:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines or [""]

    def _layout(self):
        self.layout = []  # per row: list of (x, w, h, lines, kind, label)
        y = 0
        for row in self.rows:
            n = len(row)
            if n == 1:
                node_w = 64 * mm
            else:
                node_w = min(52 * mm, (self.width - (n - 1) * self.NODE_GAP) / n)
            total_w = n * node_w + (n - 1) * self.NODE_GAP
            x0 = (self.width - total_w) / 2
            placed, row_h = [], 0
            for i, (text, kind, label) in enumerate(row):
                lines = self._wrap(text, node_w)
                h = len(lines) * self.LEAD + 2 * self.PAD_Y
                row_h = max(row_h, h)
                placed.append([x0 + i * (node_w + self.NODE_GAP), node_w, h, lines, kind, label])
            for p in placed:
                p[2] = row_h  # equal heights per row
            self.layout.append((row_h, placed))
        self._height = sum(h for h, _ in self.layout) + self.ROW_GAP * (len(self.layout) - 1)

    def wrap(self, availWidth, availHeight):
        return self.width, self._height

    def _fill_for(self, kind):
        if kind in ("start", "end"):
            return EMERALD, white
        if kind == "decision":
            return AMBER_TINT, black
        if kind == "stop":  # neutral terminal (branch ends without success)
            return ZINC_200, black
        return white, black

    def _arrow(self, c, x1, y1, x2, y2, label=""):
        c.setStrokeColor(ZINC_500)
        c.setLineWidth(0.9)
        c.line(x1, y1, x2, y2)
        # arrowhead
        import math
        ang = math.atan2(y2 - y1, x2 - x1)
        for da in (2.6, -2.6):
            c.line(x2, y2, x2 - 4.5 * math.cos(ang + da), y2 - 4.5 * math.sin(ang + da))
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            c.setFont("Helvetica-Oblique", 6.5)
            c.setFillColor(ZINC_700)
            tw = stringWidth(label, "Helvetica-Oblique", 6.5)
            c.setFillColor(white)
            c.rect(mx - tw / 2 - 1.5, my - 3, tw + 3, 8, stroke=0, fill=1)
            c.setFillColor(ZINC_700)
            c.drawCentredString(mx, my - 1, label)

    def draw(self):
        c = self.canv
        # y of the TOP of each row (flowable origin is bottom-left)
        tops = []
        y = self._height
        for row_h, _ in self.layout:
            tops.append(y)
            y -= row_h + self.ROW_GAP

        # boxes
        for (row_h, placed), top in zip(self.layout, tops):
            for x, w, h, lines, kind, _ in placed:
                fill, txt_color = self._fill_for(kind)
                c.setFillColor(fill)
                c.setStrokeColor(EMERALD_DARK if kind in ("start", "end") else ZINC_400)
                c.setLineWidth(1)
                c.roundRect(x, top - h, w, h, 3.5, stroke=1, fill=1)
                c.setFillColor(txt_color)
                c.setFont(self.FONT, self.FSIZE)
                ty = top - self.PAD_Y - self.FSIZE + 1.5
                for ln in lines:
                    c.drawCentredString(x + w / 2, ty, ln)
                    ty -= self.LEAD

        # arrows between consecutive rows — terminal nodes (end/stop)
        # never emit an outgoing arrow.
        TERMINAL = ("end", "stop")
        for i in range(len(self.layout) - 1):
            row_h_a, placed_a = self.layout[i]
            row_h_b, placed_b = self.layout[i + 1]
            top_a, top_b = tops[i], tops[i + 1]
            bottoms_a = [(x + w / 2, top_a - row_h_a, kind)
                         for x, w, h, lines, kind, lbl in placed_a]
            tops_b = [(x + w / 2, top_b) for x, w, *_ in placed_b]
            labels_b = [lbl for *_, lbl in placed_b]
            live_a = [(ax, ay) for ax, ay, kind in bottoms_a if kind not in TERMINAL]
            if not live_a:
                continue
            if len(placed_a) == 1:
                for (bx, by), lbl in zip(tops_b, labels_b):
                    self._arrow(c, live_a[0][0], live_a[0][1], bx, by, lbl)
            elif len(placed_b) == 1:
                for j, (ax, ay) in enumerate(live_a):
                    self._arrow(c, ax, ay, tops_b[0][0], tops_b[0][1], labels_b[0] if j == 0 else "")
            else:
                for (ax, ay, kind), (bx, by), lbl in zip(bottoms_a, tops_b, labels_b):
                    if kind in TERMINAL:
                        continue
                    self._arrow(c, ax, ay, bx, by, lbl)


# ── Document scaffolding ────────────────────────────────────────────
def make_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="DocTitle", parent=styles["Title"], fontSize=28,
                              textColor=EMERALD, spaceAfter=6, alignment=TA_CENTER,
                              fontName="Helvetica-Bold"))
    styles.add(ParagraphStyle(name="DocSubtitle", parent=styles["Normal"], fontSize=12,
                              textColor=ZINC_500, spaceAfter=20, alignment=TA_CENTER))
    styles.add(ParagraphStyle(name="SectionTitle", parent=styles["Heading1"], fontSize=16,
                              textColor=EMERALD, spaceBefore=18, spaceAfter=8,
                              fontName="Helvetica-Bold", borderWidth=1,
                              borderColor=EMERALD, borderPadding=4))
    styles.add(ParagraphStyle(name="SubSection", parent=styles["Heading2"], fontSize=12.5,
                              textColor=AMBER, spaceBefore=12, spaceAfter=5,
                              fontName="Helvetica-Bold"))
    styles.add(ParagraphStyle(name="FlowTitle", parent=styles["Heading3"], fontSize=10.5,
                              textColor=HexColor("#60a5fa"), spaceBefore=10, spaceAfter=6,
                              fontName="Helvetica-Bold"))
    styles.add(ParagraphStyle(name="Body", parent=styles["Normal"], fontSize=9.5,
                              textColor=black, spaceAfter=3.5, leading=13))
    styles.add(ParagraphStyle(name="URL", parent=styles["Normal"], fontSize=8.5,
                              textColor=BLUE, spaceAfter=4, fontName="Courier"))
    styles.add(ParagraphStyle(name="Note", parent=styles["Normal"], fontSize=8.5,
                              textColor=ZINC_700, spaceAfter=4, leftIndent=10,
                              fontName="Helvetica-Oblique", leading=11.5))
    return styles


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(ZINC_400)
    canvas.drawString(MARGIN, 11 * mm, "Momentum Arena — Complete Feature Guide v2.0")
    canvas.drawRightString(PAGE_W - MARGIN, 11 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "Momentum-Arena-Feature-Guide.pdf")
    doc = SimpleDocTemplate(out, pagesize=A4, topMargin=18 * mm,
                            bottomMargin=20 * mm, leftMargin=MARGIN, rightMargin=MARGIN)
    st = make_styles()
    story = []

    def S(t):
        story.append(Paragraph(t, st["SectionTitle"]))

    def sub(t):
        story.append(Paragraph(t, st["SubSection"]))

    def body(t):
        story.append(Paragraph(t, st["Body"]))

    def bullets(items):
        for i in items:
            story.append(Paragraph("• " + i, st["Body"]))

    def url(t):
        story.append(Paragraph(t, st["URL"]))

    def note(t):
        story.append(Paragraph(t, st["Note"]))

    def flow(title, rows):
        story.append(KeepTogether([
            Paragraph("FLOW: " + title, st["FlowTitle"]),
            FlowChart(rows),
            Spacer(1, 4 * mm),
        ]))

    def table(data, widths, header_bg=EMERALD):
        t = Table(data, colWidths=widths)
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("BACKGROUND", (0, 0), (-1, 0), header_bg),
            ("GRID", (0, 0), (-1, -1), 0.5, ZINC_400),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(t)

    # ══ COVER ═══════════════════════════════════════════════════════
    story.append(Spacer(1, 46 * mm))
    story.append(Paragraph("MOMENTUM ARENA", st["DocTitle"]))
    story.append(Paragraph("Complete Feature Guide", st["DocSubtitle"]))
    story.append(Paragraph(VERSION, st["DocSubtitle"]))
    story.append(Paragraph("Mathura's Premier Multi-Sport Arena", st["DocSubtitle"]))
    story.append(Paragraph("Web · iOS App · Android App — every feature with its flow", st["DocSubtitle"]))
    story.append(Spacer(1, 8 * mm))

    toc = [
        ["#", "Section"],
        ["1", "Platform Overview"],
        ["2", "Customer — Authentication & Onboarding"],
        ["3", "Customer — Home & Navigation"],
        ["4", "Customer — Court Booking"],
        ["5", "Customer — Bowling Machine Booking"],
        ["6", "Customer — Waitlist"],
        ["7", "Customer — Recurring Bookings"],
        ["8", "Customer — Checkout, Discounts & Payments"],
        ["9", "Customer — Momentum Points (Rewards)"],
        ["10", "Customer — My Bookings & Account"],
        ["11", "Customer — Cafe Ordering"],
        ["12", "Customer — Shop (Pickup Store)"],
        ["13", "Customer — Chat Assistant"],
        ["14", "Push Notifications & Auto-Push Templates"],
        ["15", "Admin — Access, Roles & Permissions"],
        ["16", "Admin — Bookings Operations"],
        ["17", "Admin — Courts, Pricing & Slot Inventory"],
        ["18", "Admin — Cafe & Shop Operations"],
        ["19", "Admin — Promotions: Coupons, Groups & Rewards"],
        ["20", "Admin — Payments: Settings, Dashboards & Recovery"],
        ["21", "Admin — Expenses & Running Expenses"],
        ["22", "Admin — Analytics & Insights"],
        ["23", "Mobile App Platform (OTA, Releases, Version Gates)"],
        ["24", "Invoices & Documents"],
    ]
    table(toc, [12 * mm, 148 * mm])
    story.append(PageBreak())

    # ══ 1. PLATFORM OVERVIEW ════════════════════════════════════════
    S("1. PLATFORM OVERVIEW")
    body("Momentum Arena runs one product on three surfaces backed by a single system:")
    bullets([
        "<b>Web</b> — www.momentumarena.com (customer site + full admin console).",
        "<b>iOS + Android apps</b> — customer experience plus the complete admin console (full parity with web admin), distributed via TestFlight / App Store and Google Play.",
        "<b>Environments</b> — production (main branch) and staging (development branch at development.momentumarena.com); every git push deploys automatically with schema-atomic builds.",
    ])
    sub("Business modules")
    body("Court booking (cricket, football, pickleball + bowling machine), cafe with live kitchen board, pickup shop with POS, Momentum Points rewards, coupons engine, waitlist, recurring bookings, push notifications, expenses tracking, and a full analytics stack (first-party events + Google Analytics 4 on all three surfaces).")
    sub("Tech stack")
    body("Next.js App Router + TypeScript + Prisma/PostgreSQL (Neon) on Vercel · React Native apps (self-hosted OTA updates) · Firebase (push + analytics) · Razorpay and PhonePe payments · MSG91 (SMS OTP + email).")

    # ══ 2. AUTH ═════════════════════════════════════════════════════
    S("2. CUSTOMER — AUTHENTICATION & ONBOARDING")
    body("One auth model on all surfaces: mobile-number OTP. No passwords for customers.")
    bullets([
        "Login modal (web) / login screens (app) — 10-digit phone, 6-digit OTP via MSG91 SMS.",
        "Android auto-reads the OTP (SMS User Consent); resend with cooldown.",
        "New users are asked for their name right after OTP verification, then land signed-in.",
        "Optional referral code at signup — both sides earn bonus Momentum Points.",
        "Server-side abuse protection: per-phone rate limits + failed-attempt lockouts.",
        "Browsing is open — login is required only at the payment step (checkout) and for account pages.",
        "In-app account deletion (store-compliance) with full data cleanup.",
    ])
    flow("Sign in / sign up", [
        [("Enter mobile number (+ optional referral code)", "start")],
        [("OTP sent via SMS", "step")],
        [("Enter 6-digit OTP (auto-read on Android)", "step")],
        [("New user?", "decision")],
        [("Enter your name", "step", "Yes"), ("Signed in", "end", "No")],
        [("Signed in + signup bonus points", "end")],
    ])

    # ══ 3. HOME ═════════════════════════════════════════════════════
    S("3. CUSTOMER — HOME & NAVIGATION")
    url("Web: /   ·   App: Home tab")
    bullets([
        "Hero with sport tiles (Cricket, Football, Pickleball) and Order Food CTA.",
        "Signed-in home shows upcoming bookings and the rewards points chip.",
        "Pickleball launch-promo banner appears automatically while its coupon is live.",
        "Facilities, contact, Google Maps, WhatsApp + social links (web).",
        "App bottom tabs: Home · Sports · Cafe · Shop · Account. Web mirrors with header/bottom nav.",
        "Force-update gate in the app: admin can require a minimum version; soft-update nags once per session.",
    ])

    # ══ 4. COURT BOOKING ════════════════════════════════════════════
    S("4. CUSTOMER — COURT BOOKING")
    url("Web: /book → /book/[sport] → slots → /book/checkout   ·   App: Sports tab")
    sub("Choose sport & court")
    bullets([
        "Sports: Cricket, Football, Pickleball (admin can add court configs per sport).",
        "Court options with size diagrams (e.g. half-field 'venue assigns a side'); single-option sports skip straight to slots.",
        "Cricket additionally offers the Bowling Machine (separate flow, section 5).",
    ])
    sub("Pick date & slots")
    bullets([
        "30-day date strip; hourly grid 5 AM – 1 AM with per-slot prices (peak / off-peak / weekend via admin time classifications).",
        "Any combination of available hours — multi-select, no contiguity restriction.",
        "Full slots are tappable: see WHY it's blocked plus alternative courts/times, or join the waitlist (section 6).",
        "Late-night 12–1 AM slot appears on the night it belongs to (display-shifted).",
        "Rental gear picker (e.g. bats, machine balls) — per-slot pricing, snapshotted onto the booking.",
    ])
    sub("Hold & lock")
    bullets([
        "Selecting slots creates a 5-minute hold with a live countdown at checkout — no one can double-book underneath you.",
        "Conflicts caught at lock time list exactly which hours were just taken.",
        "Expired hold = friendly 'slot released' alert and a clean restart.",
    ])
    flow("Book a court", [
        [("Pick sport", "start")],
        [("Pick court / size", "step")],
        [("Pick date + hour slots (+ gear)", "step")],
        [("Slots available?", "decision")],
        [("5-min hold created", "step", "Yes"), ("See reason, pick alternatives or join waitlist", "stop", "No")],
        [("Checkout: coupons, points, full or 50% advance", "step")],
        [("Pay (UPI sheet / gateway)", "step")],
        [("Booking confirmed + push + reminders", "end")],
    ])

    # ══ 5. BOWLING ══════════════════════════════════════════════════
    S("5. CUSTOMER — BOWLING MACHINE BOOKING")
    bullets([
        "30-minute slots (vs hourly courts) with contiguous-selection enforcement.",
        "Own availability grid + pricing; machine-ball rental add-on.",
        "Same hold → checkout → payment pipeline as courts.",
    ])

    # ══ 6. WAITLIST ═════════════════════════════════════════════════
    S("6. CUSTOMER — WAITLIST")
    bullets([
        "Tap a full future slot → join the waitlist for that court + hour.",
        "The moment the slot frees (cancellation/admin change), everyone whose range covers it gets a push notification.",
        "Waitlist screen under Account lists entries with one-tap Book Now (prefilled date/slot).",
        "Entries can be cancelled anytime; joins are tracked in analytics for demand insight.",
    ])
    flow("Waitlist", [
        [("Tap an unavailable slot", "start")],
        [("Join waitlist", "step")],
        [("Slot frees up", "step")],
        [("Push: 'Slot available'", "step")],
        [("Book Now → prefilled booking flow", "end")],
    ])

    # ══ 7. RECURRING ════════════════════════════════════════════════
    S("7. CUSTOMER — RECURRING BOOKINGS")
    bullets([
        "Weekly or daily series with admin-configured duration discounts (e.g. 4 weeks = X% off).",
        "Series pricing shown up front; one payment covers the series.",
        "Manage & cancel the series from the app (Recurring screen).",
        "Admin has a matching recurring console (create/manage on behalf of customers).",
    ])
    flow("Recurring series", [
        [("Enable 'Repeat' on slot selection", "start")],
        [("Choose weekly or daily", "step")],
        [("Choose duration → discount applied", "step")],
        [("Pay once for the series", "step")],
        [("All occurrences booked; manage/cancel anytime", "end")],
    ])

    # ══ 8. CHECKOUT & PAYMENTS ══════════════════════════════════════
    S("8. CUSTOMER — CHECKOUT, DISCOUNTS & PAYMENTS")
    sub("Checkout")
    bullets([
        "Booking summary with per-slot breakdown, gear, points discount and live total.",
        "Amount choice: Pay Full or Pay 50% Advance (remainder at venue) — admin can toggle advance off.",
        "Earn-preview: 'You'll earn N Momentum Points' updates live with the payable amount.",
    ])
    sub("Discounts (auto-apply chain)")
    bullets([
        "APPFIRST — first-ever app booking discount (app-only), attempted automatically & safely.",
        "New-user discount — auto-applied when eligible.",
        "Sport fallback promos (e.g. PICKLEBALL25, FLAT100) — auto-applied when nothing better fits.",
        "Manual code entry + a browsable coupon drawer (targeted coupons via user groups).",
    ])
    flow("Auto-apply discount chain", [
        [("Checkout opens", "start")],
        [("Try APPFIRST (app only)", "step")],
        [("Eligible?", "decision")],
        [("Applied", "end", "Yes"), ("Try new-user discount", "step", "No")],
        [("Eligible?", "decision")],
        [("Applied", "end", "Yes"), ("Apply sport fallback promo", "end", "No")],
    ])
    sub("Payment methods")
    bullets([
        "<b>UPI (recommended, zero gateway fee)</b> — a Razorpay-style dark bottom sheet with three admin-selectable modes:",
        "<b>UPI Intent</b>: pick PhonePe / GPay / Paytm / BHIM / Other → app opens with amount prefilled → auto-confirm via PhonePe Dynamic QR + status polling.",
        "<b>Scan QR</b>: dynamic QR bound to this exact payment; auto-confirms, no screenshots.",
        "<b>Static QR fallback</b>: pay to venue VPA → booking pends → WhatsApp screenshot → admin UTR verification.",
        "<b>Card / Netbanking</b> — Razorpay native sheet (web + app), signature-verified server-side.",
        "Admin controls which of these are live from Payment Settings (section 20).",
        "Safety nets: server-to-server payment callbacks, webhook capture of orphaned payments, payment-recovery queue.",
    ])
    flow("UPI payment (dynamic QR)", [
        [("Tap Pay via UPI", "start")],
        [("Razorpay-style sheet opens", "step")],
        [("Intent enabled?", "decision")],
        [("Pick UPI app → deep-link with amount", "step", "Yes"), ("Dynamic QR shown → scan", "step", "No")],
        [("PhonePe confirms (poll + server callback)", "step")],
        [("Success animation → booking auto-confirmed", "end")],
    ])

    # ══ 9. REWARDS ══════════════════════════════════════════════════
    S("9. CUSTOMER — MOMENTUM POINTS")
    bullets([
        "Earn on bookings and cafe orders (admin-set rates per sport / cafe), plus signup, referral and birthday bonuses.",
        "Advance-pay bookings earn on the advance now and the remainder when the venue collects it.",
        "Redeem at checkout with a live slider — capped at an admin-set % of the bill, minimum redeem threshold.",
        "Rewards screen: balance, full transaction history, 'how it works' explainer; points chip on home/account.",
        "Every earn triggers a push (each type individually editable/toggleable by admin — section 14).",
    ])
    flow("Earn & redeem loop", [
        [("Pay for booking / cafe order", "start")],
        [("Points credited (rate x bill)", "step")],
        [("Balance grows (+signup/referral/birthday bonuses)", "step")],
        [("Next checkout: redeem slider (capped %)", "step")],
        [("Discount applied → pay less → earn again", "end")],
    ])

    # ══ 10. MY BOOKINGS & ACCOUNT ═══════════════════════════════════
    S("10. CUSTOMER — MY BOOKINGS & ACCOUNT")
    bullets([
        "Bookings list: upcoming vs past, infinite scroll, status badges (confirmed / pending / completed / absent / cancelled / refunded).",
        "Booking detail: full breakdown, payment info, add-to-calendar (ICS) export; invoice download on web.",
        "Account hub: edit name, Momentum Points tile, My Coupons browser, Waitlist, policies, sign-out, delete account.",
        "Confirmation push on booking + reminders at 24h / 2h / 1h before play.",
    ])

    # ══ 11. CAFE ════════════════════════════════════════════════════
    S("11. CUSTOMER — CAFE ORDERING")
    url("Web: /cafe   ·   App: Cafe tab")
    bullets([
        "Live menu grouped by category with veg/non-veg marks, photos and real-time stock (sold-out greys out; stock caps quantity).",
        "Admin can close the cafe → warm 'closed' screen with hours.",
        "Cart with quantity steppers → checkout with coupon field and order note.",
        "Guests can order without an account (name + phone optional on web).",
        "Pay via UPI (same dynamic-QR sheet as bookings), card/netbanking, or cash at counter.",
        "Order tracking screen polls kitchen status; push when the kitchen starts preparing and when it's ready.",
        "Earn Momentum Points on cafe spend; cafe-scoped coupons supported.",
    ])
    flow("Cafe order", [
        [("Browse menu → add to cart", "start")],
        [("Checkout (coupon, note, table/takeaway)", "step")],
        [("Pay: UPI / card / cash at counter", "step")],
        [("Order lands on kitchen live board", "step")],
        [("Preparing (push)", "step")],
        [("Ready for pickup (push)", "step")],
        [("Completed", "end")],
    ])

    # ══ 12. SHOP ════════════════════════════════════════════════════
    S("12. CUSTOMER — SHOP")
    bullets([
        "Pickup-at-venue product catalog (equipment, merch) on web + app.",
        "Product detail with images and stock; order online, collect at the venue.",
        "Same payment stack as cafe; order history with status tracking.",
        "Admin-side POS covers walk-in sales (section 18).",
    ])

    # ══ 13. CHAT ════════════════════════════════════════════════════
    S("13. CUSTOMER — CHAT ASSISTANT")
    bullets([
        "Built-in assistant (web widget + full app tab) answering from the FAQ knowledge base.",
        "Intent matching with quick-action buttons that deep-link into booking, cafe, rewards etc.",
        "FAQ content is fully admin-managed (categories, keywords, ordering).",
    ])

    # ══ 14. PUSH ════════════════════════════════════════════════════
    S("14. PUSH NOTIFICATIONS & AUTO-PUSH TEMPLATES")
    body("Firebase Cloud Messaging to both apps, with tap-routing to the right screen. Two halves:")
    sub("Automated pushes (20 registered triggers)")
    bullets([
        "Customer: booking confirmed / cancelled / refunded, 24h / 2h / 1h reminders, waitlist slot available, cafe preparing / ready, 7 rewards-earned variants.",
        "Admin devices: new pending booking, booking confirmed / cancelled / refunded alerts.",
    ])
    sub("Admin-configurable templates")
    bullets([
        "Every automated push is editable from Admin → Auto Push Messages (web + app): title, body, per-push enable/disable.",
        "Documented {variables} per message with insert-chips and live preview; typo-guard rejects unknown placeholders.",
        "Edits apply on the very next send — no deploy. New triggers MUST register in the template registry, so future pushes are automatically configurable.",
        "Manual push console: broadcast or targeted sends (user groups / individual), plus delivery analytics.",
    ])
    flow("Automated push pipeline", [
        [("Trigger fires (e.g. booking confirmed)", "start")],
        [("Look up template registry key", "step")],
        [("Enabled by admin?", "decision")],
        [("Merge admin-edited title/body", "step", "Yes"), ("Skipped (logged)", "stop", "No")],
        [("Substitute {variables}", "step")],
        [("FCM → device → tap opens the right screen", "end")],
    ])

    # ══ 15. ADMIN ACCESS ════════════════════════════════════════════
    S("15. ADMIN — ACCESS, ROLES & PERMISSIONS")
    url("Web: /godmode → /admin   ·   App: hidden 5-tap entry on the Account screen")
    bullets([
        "Separate admin session (independent of the customer session).",
        "Roles: SUPERADMIN (everything, undeletable), ADMIN (granular permissions), STAFF (restricted to day-to-day booking ops + live cafe board).",
        "Admin invites via email with expiring set-password links; password reset + superadmin-alert emails.",
        "The mobile admin console mirrors web admin at full parity, permission-gated per screen and per API route.",
    ])
    body("<b>Permissions:</b> MANAGE_BOOKINGS · MANAGE_PRICING · MANAGE_SLOTS · MANAGE_SPORTS · MANAGE_USERS · MANAGE_DISCOUNTS · MANAGE_FAQS · VIEW_ANALYTICS · VIEW_RAZORPAY · MANAGE_ADMIN_USERS (superadmin-only) · MANAGE_CAFE_MENU · MANAGE_CAFE_ORDERS · MANAGE_CAFE_DISCOUNTS · MANAGE_REWARDS · MANAGE_COUPONS · MANAGE_EXPENSES · MANAGE_PUSH · MANAGE_SHOP_CATALOG · MANAGE_SHOP_ORDERS · MANAGE_APP_RELEASES · MANAGE_PAYMENT_SETTINGS")

    # ══ 16. ADMIN BOOKINGS ══════════════════════════════════════════
    S("16. ADMIN — BOOKINGS OPERATIONS")
    bullets([
        "<b>All Bookings</b>: search, multi-select status/sport filters, sort options, pagination; detail page with full history log.",
        "<b>Unconfirmed queue</b>: pending payments (static-QR/UTR & advance flows) for one-tap verify/confirm.",
        "<b>Calendar</b>: full 24-hour day grid across all courts, color-coded, tap-to-inspect, off-hours admin bookings priced at PEAK.",
        "<b>Create booking</b>: book on behalf of walk-in/phone customers, any hour of the day, any payment method incl. cash/free.",
        "<b>Check-in</b>: mark arrivals; complete or mark ABSENT after the slot (absent shows advance-only owed).",
        "<b>Extend +30 min</b>: stretch a live booking when the next slot is free, price auto-added and logged.",
        "<b>Cancel / refund</b> with reason (customer gets the push); every mutation logged with who/when.",
        "<b>UTR verification</b> screen for static-QR payments; <b>Payment Recovery</b> for money-captured-but-no-booking cases (section 20).",
        "Recurring console for series management.",
    ])
    flow("Booking lifecycle (ops view)", [
        [("Booking lands", "start")],
        [("Payment auto-verified?", "decision")],
        [("CONFIRMED (+push)", "step", "Yes"), ("Unconfirmed queue → admin verifies UTR/screenshot", "step", "No")],
        [("Play day: check-in", "step")],
        [("Played?", "decision")],
        [("COMPLETED (+remainder collected → points top-up)", "end", "Yes"), ("ABSENT (advance retained)", "end", "No")],
    ])

    # ══ 17. ADMIN COURTS & PRICING ══════════════════════════════════
    S("17. ADMIN — COURTS, PRICING & SLOT INVENTORY")
    bullets([
        "<b>Sports & courts</b>: court configurations per sport (sizes, zones, half-court behaviour), enable/disable instantly.",
        "<b>Equipment</b>: rentable gear catalog with per-slot pricing, attached to sports.",
        "<b>Pricing matrix</b>: per court x time-classification (weekday off-peak / peak / weekend...), inline editing.",
        "<b>Time classifications</b>: admin-defined day/hour bands that drive slot pricing.",
        "<b>Slot blocks</b>: block hours or whole days per court / sport / venue for maintenance and events.",
        "<b>Generator</b>: bulk slot/pricing generation utility.",
    ])

    # ══ 18. ADMIN CAFE & SHOP ═══════════════════════════════════════
    S("18. ADMIN — CAFE & SHOP OPERATIONS")
    sub("Cafe")
    bullets([
        "Menu CRUD with images, veg/non-veg, tags, category ordering and stock counts (auto-decrement on order).",
        "Cafe open/closed master switch.",
        "Orders list + stats; <b>Live kitchen board</b>: Pending → Preparing → Ready kanban, auto-refresh, sound alert, fullscreen KDS mode.",
        "Create order (walk-in), cafe-scoped coupons.",
    ])
    sub("Shop")
    bullets([
        "Product catalog CRUD with stock, product orders management,",
        "<b>Walk-in POS</b>: ring up in-person sales with any payment method.",
    ])

    # ══ 19. ADMIN PROMOTIONS ════════════════════════════════════════
    S("19. ADMIN — PROMOTIONS")
    sub("Coupons")
    bullets([
        "Unified engine for sports + cafe: percentage (with cap) or flat; min-amount, validity windows, usage limits per user/total.",
        "Platform targeting (web-only / app-only / both) and special conditions like FIRST_APP_BOOKING (powers APPFIRST).",
        "User-group targeting: cohorts defined once under Settings → User Groups feed coupons AND push targeting.",
        "Public/hidden toggle; hidden codes work but don't show in browse.",
    ])
    sub("Rewards configuration")
    bullets([
        "Earn rates per sport and for cafe, redeem rate, min redeem, max-% cap per order.",
        "Signup / referral / birthday bonus amounts; manual point adjustments per user with audit trail.",
    ])

    # ══ 20. ADMIN PAYMENTS ══════════════════════════════════════════
    S("20. ADMIN — PAYMENTS")
    sub("Payment Settings (live switches, no deploy)")
    bullets([
        "Online payments master toggle · Pay-50%-advance toggle.",
        "UPI QR mode: <b>Static QR</b> or <b>Dynamic QR (PhonePe)</b> — mutually exclusive; DQR carries a nested <b>UPI Intent</b> toggle (tap-to-pay app list vs scan-only).",
        "Active gateway selector (Razorpay / PhonePe) drives every checkout on web + app instantly.",
    ])
    sub("Dashboards & recovery")
    bullets([
        "Razorpay dashboard: live transactions from the gateway API.",
        "PhonePe dashboard: DQR + static QR transaction views with per-store tabs (Online / Offline / Gym / Yoga / Cafe).",
        "<b>Payment Recovery</b>: webhook + sweep catch payments captured without a booking (hold expired mid-payment); admin resolves to booking or refund — no customer money can silently vanish.",
    ])
    flow("Orphaned payment recovery", [
        [("Customer pays but hold already expired", "start")],
        [("Gateway webhook / reconciliation sweep flags it", "step")],
        [("Recovery queue entry created", "step")],
        [("Admin reviews", "decision")],
        [("Recreate booking", "end", "Slot free"), ("Refund customer", "end", "Slot gone")],
    ])

    # ══ 21. EXPENSES ════════════════════════════════════════════════
    S("21. ADMIN — EXPENSES & RUNNING EXPENSES")
    bullets([
        "<b>Expenses (legacy)</b>: historical ledger, now read-only — no new entries or edits.",
        "<b>Running Expenses</b>: active ledger with admin-defined dropdown configs (category, payment mode...), month-wise collapsible table, add/edit via modal (desktop) / bottom-sheet (mobile), filters.",
        "Separate analytics for each module: totals, category breakdowns, trends.",
        "Available on web admin and the admin app.",
    ])

    # ══ 22. ANALYTICS ═══════════════════════════════════════════════
    S("22. ADMIN — ANALYTICS & INSIGHTS")
    bullets([
        "<b>Business analytics</b>: revenue/bookings KPIs, sport-wise & cafe breakdowns, peak-hours, payment-method mix, top customers, date-range/grouping filters.",
        "<b>Demand insight</b>: waitlist pressure and slot-unavailable taps show where capacity is short.",
        "<b>Funnels</b>: booking funnel (sport → slots → checkout → paid) with drop-off per step.",
        "<b>Cohorts</b>: user cohorts frozen at first booking; retention views.",
        "<b>Events explorer</b>: every first-party event (web + app) searchable with properties, sessions and user attribution.",
        "<b>Push analytics</b>: delivery/open stats per campaign.",
        "<b>Reports</b>: scheduled/queued report generation (processed by cron).",
        "<b>Google Analytics 4</b> runs in parallel on web + iOS + Android (Firebase), with identical event names across surfaces.",
    ])
    flow("Analytics data pipeline", [
        [("User acts on web / iOS / Android", "start")],
        [("Typed event fires (same name on all surfaces)", "step")],
        [("First-party store (all envs)", "step", ""), ("GA4 / Firebase (production only)", "step", "")],
        [("Hourly rollups + dashboards, funnels, cohorts", "end")],
    ])

    # ══ 23. MOBILE PLATFORM ═════════════════════════════════════════
    S("23. MOBILE APP PLATFORM")
    sub("Self-hosted OTA updates")
    bullets([
        "JS-level app updates ship over-the-air from our own server — no store review for UI/logic changes.",
        "Admin OTA dashboard: draft releases per channel, staged percentage rollouts, promote/rollback, device adoption stats.",
        "Updates are code-signed; apps auto-apply pending updates on launch.",
    ])
    sub("Release pipeline")
    bullets([
        "Every push with mobile changes auto-publishes an OTA draft; a native fingerprint decides JS-only vs native.",
        "Native changes on the development branch auto-trigger store builds (TestFlight / Play internal); production store builds are a deliberate manual dispatch.",
        "Release Flow page documents the whole pipeline; version gates let admin force or suggest app updates.",
    ])
    flow("Ship an app change", [
        [("Merge mobile change", "start")],
        [("Native fingerprint changed?", "decision")],
        [("Store build (auto on dev / manual for prod)", "step", "Yes"), ("OTA draft published", "step", "No")],
        [("Admin rolls out (staged %)", "step")],
        [("Devices update on next launch", "end")],
    ])

    # ══ 24. INVOICES ════════════════════════════════════════════════
    S("24. INVOICES & DOCUMENTS")
    bullets([
        "Booking invoice PDF on company letterhead with GST breakdown (download from booking detail, web).",
        "Cafe order invoice PDF in the same format.",
        "Public cafe menu PDF endpoint for QR-code table cards.",
        "Add-to-calendar (ICS) export for bookings in the app.",
    ])

    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("— END OF DOCUMENT —", ParagraphStyle(
        name="EndDoc", parent=st["Normal"], fontSize=10,
        textColor=ZINC_400, alignment=TA_CENTER)))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"PDF generated: {out}")


if __name__ == "__main__":
    build_pdf()
