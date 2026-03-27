#!/usr/bin/env python3
"""Generate Momentum Arena Feature Guide & Manual Testing Document PDF"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, KeepTogether
)

# Colors
EMERALD = HexColor("#10b981")
EMERALD_DARK = HexColor("#065f46")
AMBER = HexColor("#f59e0b")
AMBER_DARK = HexColor("#92400e")
ZINC_900 = HexColor("#18181b")
ZINC_800 = HexColor("#27272a")
ZINC_700 = HexColor("#3f3f46")
ZINC_400 = HexColor("#a1a1aa")
RED = HexColor("#ef4444")
BLUE = HexColor("#3b82f6")
PURPLE = HexColor("#a855f7")

def build_pdf():
    output_path = "/Users/nakulvarshney/Workspace/momentum-arena/.claude/worktrees/naughty-buck/Momentum-Arena-Feature-Guide.pdf"

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        topMargin=20*mm,
        bottomMargin=20*mm,
        leftMargin=18*mm,
        rightMargin=18*mm,
    )

    styles = getSampleStyleSheet()

    # Custom styles
    styles.add(ParagraphStyle(
        name='DocTitle',
        parent=styles['Title'],
        fontSize=28,
        textColor=EMERALD,
        spaceAfter=6,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='DocSubtitle',
        parent=styles['Normal'],
        fontSize=12,
        textColor=ZINC_400,
        spaceAfter=20,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name='SectionTitle',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=EMERALD,
        spaceBefore=20,
        spaceAfter=10,
        fontName='Helvetica-Bold',
        borderWidth=1,
        borderColor=EMERALD,
        borderPadding=4,
    ))
    styles.add(ParagraphStyle(
        name='SubSection',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=AMBER,
        spaceBefore=14,
        spaceAfter=6,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='SubSubSection',
        parent=styles['Heading3'],
        fontSize=11,
        textColor=HexColor("#60a5fa"),
        spaceBefore=10,
        spaceAfter=4,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        name='Body',
        parent=styles['Normal'],
        fontSize=9.5,
        textColor=black,
        spaceAfter=4,
        leading=13,
    ))
    styles.add(ParagraphStyle(
        name='URL',
        parent=styles['Normal'],
        fontSize=9,
        textColor=BLUE,
        spaceAfter=4,
        fontName='Courier',
    ))
    styles.add(ParagraphStyle(
        name='TestStep',
        parent=styles['Normal'],
        fontSize=9,
        textColor=black,
        spaceAfter=2,
        leftIndent=15,
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name='Expected',
        parent=styles['Normal'],
        fontSize=9,
        textColor=EMERALD_DARK,
        spaceAfter=6,
        leftIndent=15,
        fontName='Helvetica-Oblique',
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name='Note',
        parent=styles['Normal'],
        fontSize=8.5,
        textColor=ZINC_700,
        spaceAfter=4,
        leftIndent=10,
        fontName='Helvetica-Oblique',
    ))

    story = []

    # ============ COVER PAGE ============
    story.append(Spacer(1, 60*mm))
    story.append(Paragraph("MOMENTUM ARENA", styles['DocTitle']))
    story.append(Paragraph("Complete Feature Guide &<br/>Manual Testing Document", styles['DocSubtitle']))
    story.append(Spacer(1, 10*mm))
    story.append(Paragraph("Version 1.0 | March 2026", styles['DocSubtitle']))
    story.append(Spacer(1, 5*mm))
    story.append(Paragraph("Mathura's Premier Multi-Sport Arena", styles['DocSubtitle']))
    story.append(Spacer(1, 15*mm))

    # Table of contents summary
    toc_data = [
        ["Section", "Page"],
        ["1. Customer - Homepage & Navigation", "3"],
        ["2. Customer - Authentication (Login/Signup)", "4"],
        ["3. Customer - Sports Booking Flow", "5"],
        ["4. Customer - Cafe Ordering", "8"],
        ["5. Customer - Dashboard & Profile", "10"],
        ["6. Customer - Rewards & Coupons", "11"],
        ["7. Admin - Login (Godmode)", "12"],
        ["8. Admin - Overview Dashboard", "13"],
        ["9. Admin - Bookings (Calendar + List)", "14"],
        ["10. Admin - Create Booking", "16"],
        ["11. Admin - Pricing Management", "17"],
        ["12. Admin - Slot Blocks", "18"],
        ["13. Admin - Sports/Courts", "19"],
        ["14. Admin - User Management", "20"],
        ["15. Admin - Unified Coupon Management", "21"],
        ["16. Admin - Banners & FAQs", "22"],
        ["17. Admin - Cafe Menu Management", "23"],
        ["18. Admin - Cafe Orders & Live Dashboard", "24"],
        ["19. Admin - Analytics Dashboard", "26"],
        ["20. Admin - Reward Points Config", "27"],
        ["21. Admin - Razorpay & Admin Users", "28"],
        ["22. Invoice & PDF Generation", "29"],
        ["23. Environment & Configuration", "30"],
    ]
    toc_table = Table(toc_data, colWidths=[140*mm, 20*mm])
    toc_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TEXTCOLOR', (0, 0), (-1, 0), EMERALD),
        ('LINEBELOW', (0, 0), (-1, 0), 1, EMERALD),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(toc_table)
    story.append(PageBreak())

    # ============ SECTION 1: HOMEPAGE ============
    story.append(Paragraph("1. CUSTOMER - HOMEPAGE & NAVIGATION", styles['SectionTitle']))
    story.append(Paragraph("URL: /", styles['URL']))
    story.append(Paragraph("The homepage is the public landing page accessible without login. It showcases Momentum Arena's facilities and provides navigation to sports booking and cafe ordering.", styles['Body']))

    story.append(Paragraph("1.1 Hero Section", styles['SubSection']))
    story.append(Paragraph("- Animated floating orbs (emerald + amber glow effects)", styles['Body']))
    story.append(Paragraph("- Momentum Arena logo with glow backdrop", styles['Body']))
    story.append(Paragraph("- Title: 'MATHURA'S PREMIER MULTI-SPORT ARENA' with gradient text", styles['Body']))
    story.append(Paragraph("- Sports listed: Cricket, Football, Pickleball, Badminton", styles['Body']))
    story.append(Paragraph("- Two CTA buttons: 'Book a Court' (emerald) and 'Order Food' (amber)", styles['Body']))
    story.append(Paragraph("- Scroll indicator animation at bottom", styles['Body']))

    story.append(Paragraph("1.2 Sports Section", styles['SubSection']))
    story.append(Paragraph("- 4 sport cards (Cricket, Football, Pickleball, Badminton) with background images", styles['Body']))
    story.append(Paragraph("- Each card links to /book/[sport] for booking", styles['Body']))
    story.append(Paragraph("- Hover effects: scale, glow, 'Book Now' button appears", styles['Body']))

    story.append(Paragraph("1.3 Cafe Section", styles['SubSection']))
    story.append(Paragraph("- Dedicated section with amber gradient background", styles['Body']))
    story.append(Paragraph("- Large cafe card with category badges (Snacks, Beverages, Meals, Desserts)", styles['Body']))
    story.append(Paragraph("- Links to /cafe for ordering", styles['Body']))

    story.append(Paragraph("1.4 Facilities Section", styles['SubSection']))
    story.append(Paragraph("6 facility cards with hover effects:", styles['Body']))
    story.append(Paragraph("- Professional Turf, Floodlights, Spectator Seating, Cafeteria, Ample Parking, Clean Washrooms (M/F)", styles['Body']))

    story.append(Paragraph("1.5 Contact & Location", styles['SubSection']))
    story.append(Paragraph("- Address, phone, opening hours (5 AM - 1 AM), email", styles['Body']))
    story.append(Paragraph("- Embedded Google Maps", styles['Body']))
    story.append(Paragraph("- WhatsApp contact button (direct chat)", styles['Body']))
    story.append(Paragraph("- Follow Us: WhatsApp Channel, Instagram, YouTube", styles['Body']))

    story.append(Paragraph("1.6 Mobile Navigation", styles['SubSection']))
    story.append(Paragraph("- Fixed bottom tab bar on mobile: Home, Sports, Cafe, Account", styles['Body']))
    story.append(Paragraph("- Desktop: Sports and Cafe links in header navbar", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Homepage", styles['SubSubSection']))
    story.append(Paragraph("1. Open homepage - verify hero loads with animations", styles['TestStep']))
    story.append(Paragraph("2. Click 'Book a Court' - should scroll to sports section", styles['TestStep']))
    story.append(Paragraph("3. Click 'Order Food' - should scroll to cafe section", styles['TestStep']))
    story.append(Paragraph("4. Click each sport card - should navigate to /book/[sport]", styles['TestStep']))
    story.append(Paragraph("5. Click cafe card - should navigate to /cafe", styles['TestStep']))
    story.append(Paragraph("6. On mobile: verify bottom tab shows Home/Sports/Cafe/Account", styles['TestStep']))
    story.append(Paragraph("7. Click WhatsApp button - should open wa.me link", styles['TestStep']))
    story.append(Paragraph("Expected: All links work, animations smooth, responsive on mobile", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 2: AUTHENTICATION ============
    story.append(Paragraph("2. CUSTOMER - AUTHENTICATION", styles['SectionTitle']))

    story.append(Paragraph("2.1 Login Modal", styles['SubSection']))
    story.append(Paragraph("URL: Triggered from header 'Login' button (modal overlay)", styles['URL']))
    story.append(Paragraph("Three login methods available:", styles['Body']))
    story.append(Paragraph("<b>Google OAuth:</b> One-click Google sign-in. Email auto-verified.", styles['Body']))
    story.append(Paragraph("<b>Email OTP:</b> Enter email -> receive 6-digit OTP -> verify -> logged in", styles['Body']))
    story.append(Paragraph("<b>Email + Password:</b> For returning users who have set a password", styles['Body']))

    story.append(Paragraph("2.2 Set Password (First Time)", styles['SubSection']))
    story.append(Paragraph("After first login (Google or OTP), user sees 'Set Your Password' modal:", styles['Body']))
    story.append(Paragraph("- Password requirements: Min 10 chars, alphanumeric, 1 special character", styles['Body']))
    story.append(Paragraph("- Can skip this step ('Skip for now')", styles['Body']))
    story.append(Paragraph("- If skipped, shown again on next login", styles['Body']))
    story.append(Paragraph("- Google login auto-verifies email (no OTP needed for password setup)", styles['Body']))

    story.append(Paragraph("2.3 Forgot Password", styles['SubSection']))
    story.append(Paragraph("- From password login tab, click 'Forgot Password'", styles['Body']))
    story.append(Paragraph("- Enter email -> OTP sent -> verify OTP -> set new password", styles['Body']))
    story.append(Paragraph("- Email must be verified before password can be set", styles['Body']))

    story.append(Paragraph("2.4 Session Management", styles['SubSection']))
    story.append(Paragraph("- Sessions last 30 days", styles['Body']))
    story.append(Paragraph("- Customer and Admin sessions are SEPARATE (different cookies)", styles['Body']))
    story.append(Paragraph("- Customer cookie: authjs.session-token", styles['Body']))
    story.append(Paragraph("- Admin cookie: admin-session-token", styles['Body']))
    story.append(Paragraph("- Both can be logged in simultaneously", styles['Body']))

    story.append(Paragraph("2.5 Guest Checkout", styles['SubSection']))
    story.append(Paragraph("- Sports booking and cafe ordering do NOT require login to browse", styles['Body']))
    story.append(Paragraph("- Login required only at payment step (inline auth at checkout)", styles['Body']))
    story.append(Paragraph("- Cafe orders can be placed as guest (no login at all)", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Authentication", styles['SubSubSection']))
    story.append(Paragraph("1. Click Login -> Google -> verify redirects back logged in", styles['TestStep']))
    story.append(Paragraph("2. Click Login -> Email OTP -> enter email -> verify OTP arrives -> enter OTP", styles['TestStep']))
    story.append(Paragraph("3. After OTP login, verify 'Set Password' modal appears", styles['TestStep']))
    story.append(Paragraph("4. Set password -> sign out -> login with email+password", styles['TestStep']))
    story.append(Paragraph("5. Sign out -> verify header shows 'Login' button (not username)", styles['TestStep']))
    story.append(Paragraph("6. Login as admin at /godmode -> navigate to homepage -> verify customer session intact", styles['TestStep']))
    story.append(Paragraph("Expected: All auth flows work, sessions separate for admin/customer", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 3: SPORTS BOOKING ============
    story.append(Paragraph("3. CUSTOMER - SPORTS BOOKING FLOW", styles['SectionTitle']))

    story.append(Paragraph("3.1 Step 1: Choose Sport", styles['SubSection']))
    story.append(Paragraph("URL: /book", styles['URL']))
    story.append(Paragraph("- 4 sport cards: Cricket, Football, Pickleball, Badminton", styles['Body']))
    story.append(Paragraph("- All cards same fixed height (100px)", styles['Body']))
    story.append(Paragraph("- Inactive sports greyed out", styles['Body']))
    story.append(Paragraph("- Promo banners shown above sport cards", styles['Body']))

    story.append(Paragraph("3.2 Step 2: Choose Court Size", styles['SubSection']))
    story.append(Paragraph("URL: /book/[sport]", styles['URL']))
    story.append(Paragraph("- Lists all active court configurations for the sport", styles['Body']))
    story.append(Paragraph("- Shows court diagram with proportional dimensions", styles['Body']))
    story.append(Paragraph("- Displays dimensions (e.g., 30ft x 90ft)", styles['Body']))
    story.append(Paragraph("Cricket configs: XS (Leather Pitch), Small (Lane A/B), Medium (Left/Right Half), Large (Center), XL (Left/Right), Full Field", styles['Body']))

    story.append(Paragraph("3.3 Step 3: Select Date & Slots", styles['SubSection']))
    story.append(Paragraph("URL: /book/[sport]/[configId]", styles['URL']))
    story.append(Paragraph("- Scrollable date picker: today + 30 days", styles['Body']))
    story.append(Paragraph("- Saturday/Sunday highlighted in color", styles['Body']))
    story.append(Paragraph("- Hourly slots from 5 AM to 1 AM (20 slots per day)", styles['Body']))
    story.append(Paragraph("- Each slot shows price (varies by peak/off-peak, weekday/weekend)", styles['Body']))
    story.append(Paragraph("- Green = available, Red = booked, Gray = blocked", styles['Body']))
    story.append(Paragraph("- Past hours on current date are disabled", styles['Body']))
    story.append(Paragraph("- Zone overlap detection prevents conflicting bookings", styles['Body']))
    story.append(Paragraph("- Selected slots highlighted, total shown at bottom", styles['Body']))
    story.append(Paragraph("- 'Pay Now' button fixed at bottom on mobile", styles['Body']))

    story.append(Paragraph("3.4 Step 4: Checkout & Payment", styles['SubSection']))
    story.append(Paragraph("URL: /book/checkout?bookingId=[id]", styles['URL']))
    story.append(Paragraph("- Booking summary: sport, court, date, slots, prices", styles['Body']))
    story.append(Paragraph("- 5-minute countdown timer (lock expires)", styles['Body']))
    story.append(Paragraph("- Discount code input (unified coupon system)", styles['Body']))
    story.append(Paragraph("- New user discount auto-applied if eligible", styles['Body']))
    story.append(Paragraph("Payment methods:", styles['Body']))
    story.append(Paragraph("  1. Pay Online (Razorpay - cards, UPI, netbanking)", styles['Body']))
    story.append(Paragraph("  2. UPI QR Code (scan & send screenshot on WhatsApp)", styles['Body']))
    story.append(Paragraph("  3. Pay at Venue (20% advance online, rest in cash)", styles['Body']))

    story.append(Paragraph("3.5 Step 5: Confirmation", styles['SubSection']))
    story.append(Paragraph("URL: /book/confirmation/[bookingId]", styles['URL']))
    story.append(Paragraph("- Booking confirmed status", styles['Body']))
    story.append(Paragraph("- Full details: ID, sport, court, date, time, amount", styles['Body']))
    story.append(Paragraph("- Download Invoice button (PDF on letterhead with GST)", styles['Body']))
    story.append(Paragraph("- Invoice includes: CGST 9% + SGST 9% = 18% GST (inclusive)", styles['Body']))

    story.append(Paragraph("3.6 Slot Locking (Advisory Locks)", styles['SubSection']))
    story.append(Paragraph("- Uses PostgreSQL advisory locks (pg_advisory_xact_lock)", styles['Body']))
    story.append(Paragraph("- Zero deadlocks - each slot gets unique lock key", styles['Body']))
    story.append(Paragraph("- Lock TTL: 5 minutes", styles['Body']))
    story.append(Paragraph("- Expired locks cleaned up by cron job (/api/cron/cleanup-locks)", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Sports Booking", styles['SubSubSection']))
    story.append(Paragraph("1. Go to /book -> click Cricket -> click Small (Lane A)", styles['TestStep']))
    story.append(Paragraph("2. Select tomorrow's date -> select 2 consecutive slots", styles['TestStep']))
    story.append(Paragraph("3. Click Pay Now -> verify checkout page shows correct summary", styles['TestStep']))
    story.append(Paragraph("4. Apply a valid discount code -> verify price recalculates", styles['TestStep']))
    story.append(Paragraph("5. Select Razorpay -> complete payment -> verify confirmation page", styles['TestStep']))
    story.append(Paragraph("6. Click Download Invoice -> verify PDF has correct GST breakdown", styles['TestStep']))
    story.append(Paragraph("7. Go back to same court/date -> verify those slots show as booked", styles['TestStep']))
    story.append(Paragraph("8. Test lock expiry: select slots, wait 5+ mins, try to pay", styles['TestStep']))
    story.append(Paragraph("Expected: Full flow works, invoice correct, no double-booking possible", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 4: CAFE ============
    story.append(Paragraph("4. CUSTOMER - CAFE ORDERING", styles['SectionTitle']))

    story.append(Paragraph("4.1 Menu Page", styles['SubSection']))
    story.append(Paragraph("URL: /cafe", styles['URL']))
    story.append(Paragraph("- NO LOGIN REQUIRED to browse or order", styles['Body']))
    story.append(Paragraph("- Categories: Snacks, Beverages, Meals, Desserts, Combos", styles['Body']))
    story.append(Paragraph("- Sticky search bar and category tabs at top", styles['Body']))
    story.append(Paragraph("- Search filters by item name only", styles['Body']))
    story.append(Paragraph("- Each item card: image, name, description, price, veg/non-veg dot", styles['Body']))
    story.append(Paragraph("- Popular/Bestseller badges on featured items", styles['Body']))
    story.append(Paragraph("- Out-of-stock items greyed out", styles['Body']))
    story.append(Paragraph("- +/- quantity buttons per item", styles['Body']))
    story.append(Paragraph("- Floating cart bar at bottom: item count, total, 'View Cart'", styles['Body']))

    story.append(Paragraph("4.2 Checkout", styles['SubSection']))
    story.append(Paragraph("URL: /cafe/checkout", styles['URL']))
    story.append(Paragraph("- Guest info fields (optional): name, phone", styles['Body']))
    story.append(Paragraph("- Table number selector: Takeaway or Table 1-10", styles['Body']))
    story.append(Paragraph("- Order summary with item details", styles['Body']))
    story.append(Paragraph("- Coupon code input", styles['Body']))
    story.append(Paragraph("- Payment: Razorpay, UPI QR, Cash", styles['Body']))
    story.append(Paragraph("- Guest default: Cash | Logged-in default: Razorpay", styles['Body']))

    story.append(Paragraph("4.3 Order Confirmation", styles['SubSection']))
    story.append(Paragraph("URL: /cafe/confirmation/[orderId]", styles['URL']))
    story.append(Paragraph("- Order number, status, items, total", styles['Body']))
    story.append(Paragraph("- Download Invoice button", styles['Body']))
    story.append(Paragraph("- Accessible without login for guest orders", styles['Body']))

    story.append(Paragraph("4.4 PDF Menu", styles['SubSection']))
    story.append(Paragraph("URL: /api/cafe-menu-pdf", styles['URL']))
    story.append(Paragraph("- Public link (no auth needed) - for QR code printing", styles['Body']))
    story.append(Paragraph("- Dark amber theme with logo and clipart icons", styles['Body']))
    story.append(Paragraph("- Items grouped by category with prices", styles['Body']))
    story.append(Paragraph("- Veg/non-veg indicators, Popular/Bestseller tags", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Cafe Ordering", styles['SubSubSection']))
    story.append(Paragraph("1. Go to /cafe without login -> verify menu loads", styles['TestStep']))
    story.append(Paragraph("2. Search for an item -> verify search works by name", styles['TestStep']))
    story.append(Paragraph("3. Add 2 items to cart -> verify cart badge updates", styles['TestStep']))
    story.append(Paragraph("4. Click View Cart -> proceed to checkout", styles['TestStep']))
    story.append(Paragraph("5. Select Table 3 -> enter guest name -> pay with Cash", styles['TestStep']))
    story.append(Paragraph("6. Verify confirmation page shows order details", styles['TestStep']))
    story.append(Paragraph("7. Visit /api/cafe-menu-pdf -> verify PDF generates with all items", styles['TestStep']))
    story.append(Paragraph("Expected: Guest ordering works without login, table number saved", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 5: DASHBOARD & PROFILE ============
    story.append(Paragraph("5. CUSTOMER - DASHBOARD & PROFILE", styles['SectionTitle']))

    story.append(Paragraph("5.1 Dashboard", styles['SubSection']))
    story.append(Paragraph("URL: /dashboard (requires login)", styles['URL']))
    story.append(Paragraph("- Welcome message with user name", styles['Body']))
    story.append(Paragraph("- 'Book a Court' CTA card", styles['Body']))
    story.append(Paragraph("- 'My Profile' link", styles['Body']))
    story.append(Paragraph("- Stats: Upcoming bookings count, Total bookings, My Bookings link", styles['Body']))
    story.append(Paragraph("- Upcoming bookings list (max 3, sport icon, date, time, amount)", styles['Body']))

    story.append(Paragraph("5.2 My Bookings", styles['SubSection']))
    story.append(Paragraph("URL: /bookings (requires login)", styles['URL']))
    story.append(Paragraph("- All user bookings with status badges", styles['Body']))
    story.append(Paragraph("- Upcoming vs Past separation", styles['Body']))
    story.append(Paragraph("- Click booking -> full detail + invoice download", styles['Body']))

    story.append(Paragraph("5.3 Profile", styles['SubSection']))
    story.append(Paragraph("URL: /profile (requires login)", styles['URL']))
    story.append(Paragraph("- View/edit: name, email, phone", styles['Body']))
    story.append(Paragraph("- View: member since, total bookings, email/phone verified badges", styles['Body']))

    story.append(PageBreak())

    # ============ SECTION 6: REWARDS & COUPONS (CUSTOMER) ============
    story.append(Paragraph("6. CUSTOMER - REWARDS & COUPONS", styles['SectionTitle']))

    story.append(Paragraph("6.1 Rewards Page", styles['SubSection']))
    story.append(Paragraph("URL: /rewards", styles['URL']))
    story.append(Paragraph("Logged in: Shows tier card (Bronze/Silver/Gold/Platinum), current balance, progress bar to next tier, transaction history", styles['Body']))
    story.append(Paragraph("Not logged in: Shows program overview with tier benefits", styles['Body']))

    story.append(Paragraph("6.2 Coupons Page", styles['SubSection']))
    story.append(Paragraph("URL: /coupons", styles['URL']))
    story.append(Paragraph("- Public page (no login needed to browse)", styles['Body']))
    story.append(Paragraph("- Filter tabs: All / Sports / Cafe", styles['Body']))
    story.append(Paragraph("- Each coupon card: code, description, value, validity, terms", styles['Body']))
    story.append(Paragraph("- 'Copy Code' button on each card", styles['Body']))
    story.append(Paragraph("- Logged-in users see personalized 'For You' section (birthday, first-time)", styles['Body']))

    story.append(Paragraph("6.3 Redeem Points at Checkout", styles['SubSection']))
    story.append(Paragraph("- Slider appears on sports/cafe checkout if user has enough points", styles['Body']))
    story.append(Paragraph("- Shows: 'Use X points to save Rs.Y'", styles['Body']))
    story.append(Paragraph("- Max redeem: 50% of order value (configurable by admin)", styles['Body']))
    story.append(Paragraph("- Min redeem: 100 points (configurable)", styles['Body']))

    story.append(PageBreak())

    # ============ SECTION 7: ADMIN LOGIN ============
    story.append(Paragraph("7. ADMIN - LOGIN (GODMODE)", styles['SectionTitle']))
    story.append(Paragraph("URL: /godmode", styles['URL']))
    story.append(Paragraph("- Completely separate from customer login", styles['Body']))
    story.append(Paragraph("- Username + Password authentication", styles['Body']))
    story.append(Paragraph("- Separate cookie (admin-session-token)", styles['Body']))
    story.append(Paragraph("- Superadmin: 'gamelord' (undeletable)", styles['Body']))
    story.append(Paragraph("- After login, redirected to /admin", styles['Body']))
    story.append(Paragraph("- Logo in admin header links to /admin (not customer homepage)", styles['Body']))

    story.append(Paragraph("Admin Roles:", styles['SubSection']))
    story.append(Paragraph("<b>SUPERADMIN:</b> Full access, can create/delete admin users, cannot be deleted", styles['Body']))
    story.append(Paragraph("<b>ADMIN:</b> Granular permissions, can be deleted by superadmin", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Admin Login", styles['SubSubSection']))
    story.append(Paragraph("1. Go to /godmode -> login as 'gamelord'", styles['TestStep']))
    story.append(Paragraph("2. Verify redirected to /admin dashboard", styles['TestStep']))
    story.append(Paragraph("3. Open new tab -> go to homepage -> verify customer session not affected", styles['TestStep']))
    story.append(Paragraph("4. Sign out from admin -> verify lands on /godmode, customer session intact", styles['TestStep']))
    story.append(Paragraph("Expected: Admin/customer sessions completely independent", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 8: ADMIN OVERVIEW ============
    story.append(Paragraph("8. ADMIN - OVERVIEW DASHBOARD", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin", styles['URL']))
    story.append(Paragraph("5 stat cards: Total Bookings, Today's Bookings, Revenue Today, Active Users, Pending Payments", styles['Body']))
    story.append(Paragraph("Quick links to: Manage Bookings, Set Pricing, Block Slots, Manage Sports", styles['Body']))

    # ============ SECTION 9: BOOKINGS ============
    story.append(Paragraph("9. ADMIN - BOOKINGS MANAGEMENT", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/bookings", styles['URL']))

    story.append(Paragraph("9.1 Calendar View (Default)", styles['SubSection']))
    story.append(Paragraph("- Google Calendar-style day view", styles['Body']))
    story.append(Paragraph("- Rows = hours (5 AM to 1 AM), Columns = court configs", styles['Body']))
    story.append(Paragraph("- Date slider with prev/next day and 'Today' button", styles['Body']))
    story.append(Paragraph("- Sport filter chips (All, Cricket, Football, Pickleball, Badminton)", styles['Body']))
    story.append(Paragraph("- Color-coded cells: Green=CONFIRMED, Yellow=LOCKED, Gray=BLOCKED", styles['Body']))
    story.append(Paragraph("- Click booked cell -> booking detail modal (customer, status, payment)", styles['Body']))
    story.append(Paragraph("- Click empty cell -> quick-book modal with link to create booking", styles['Body']))
    story.append(Paragraph("- Current hour highlighted with emerald tint, auto-scrolls on load", styles['Body']))
    story.append(Paragraph("- Sticky header (court names) and sticky left column (hours)", styles['Body']))

    story.append(Paragraph("9.2 List View", styles['SubSection']))
    story.append(Paragraph("- Toggle to list view via Calendar/List buttons", styles['Body']))
    story.append(Paragraph("- Filters: status, sport, date, search", styles['Body']))
    story.append(Paragraph("- Bookings grouped by date, sorted by earliest slot", styles['Body']))
    story.append(Paragraph("- Each row: user, sport, court, time, amount, payment status", styles['Body']))
    story.append(Paragraph("- Pagination (20 per page)", styles['Body']))

    story.append(Paragraph("9.3 Booking Detail Page", styles['SubSection']))
    story.append(Paragraph("URL: /admin/bookings/[id]", styles['URL']))
    story.append(Paragraph("- Full booking info + customer info + payment info", styles['Body']))
    story.append(Paragraph("- Admin actions: Confirm, Cancel (with reason), Refund, Edit slots", styles['Body']))
    story.append(Paragraph("- Edit history tracking (who changed what, when)", styles['Body']))
    story.append(Paragraph("- Cancel & refund with reason logging", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Bookings Calendar", styles['SubSubSection']))
    story.append(Paragraph("1. Go to /admin/bookings -> verify calendar view is default", styles['TestStep']))
    story.append(Paragraph("2. Navigate dates -> verify data updates", styles['TestStep']))
    story.append(Paragraph("3. Click a booked cell -> verify detail modal shows customer info", styles['TestStep']))
    story.append(Paragraph("4. Click empty cell -> verify quick-book modal appears", styles['TestStep']))
    story.append(Paragraph("5. Filter by Cricket -> verify only cricket courts shown", styles['TestStep']))
    story.append(Paragraph("6. Toggle to List view -> verify list loads with filters", styles['TestStep']))
    story.append(Paragraph("Expected: Calendar accurate, modals work, filters responsive", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 10: CREATE BOOKING ============
    story.append(Paragraph("10. ADMIN - CREATE BOOKING", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/bookings/create", styles['URL']))
    story.append(Paragraph("5-step wizard for admin to book on behalf of a customer:", styles['Body']))
    story.append(Paragraph("Step 1: Sport & Court - Select sport, then court config", styles['Body']))
    story.append(Paragraph("Step 2: Date & Slots - Pick date, select available hours", styles['Body']))
    story.append(Paragraph("Step 3: Customer - Search existing customer or enter new (name, phone, email)", styles['Body']))
    story.append(Paragraph("Step 4: Payment - Select method (Razorpay, UPI QR, Cash, Free)", styles['Body']))
    story.append(Paragraph("Step 5: Review & Create - Summary with confirm button", styles['Body']))

    story.append(PageBreak())

    # ============ SECTION 11-16: OTHER ADMIN FEATURES ============
    story.append(Paragraph("11. ADMIN - PRICING MANAGEMENT", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/pricing", styles['URL']))
    story.append(Paragraph("- Time classifications: Weekday Off-Peak (5:00-16:00), Weekday Peak (16:00-1:00), Weekend (all peak)", styles['Body']))
    story.append(Paragraph("- Pricing matrix: rows = court configs, columns = day/time combinations", styles['Body']))
    story.append(Paragraph("- Editable inline - click price to modify", styles['Body']))
    story.append(Paragraph("- All prices in Rupees (stored as paise internally)", styles['Body']))

    story.append(Paragraph("12. ADMIN - SLOT BLOCKS", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/slots", styles['URL']))
    story.append(Paragraph("- Block specific hours or full days for maintenance/events", styles['Body']))
    story.append(Paragraph("- Can block by: specific court, entire sport, or all courts", styles['Body']))
    story.append(Paragraph("- Blocked slots show as gray in customer view and calendar", styles['Body']))

    story.append(Paragraph("13. ADMIN - SPORTS/COURTS", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/sports", styles['URL']))
    story.append(Paragraph("- Toggle individual court configurations active/inactive", styles['Body']))
    story.append(Paragraph("- Disabled courts won't appear in booking flow", styles['Body']))

    story.append(Paragraph("14. ADMIN - USER MANAGEMENT", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/users", styles['URL']))
    story.append(Paragraph("- Search users by name, email, phone", styles['Body']))
    story.append(Paragraph("- View: total bookings, member since, verification status", styles['Body']))

    story.append(Paragraph("15. ADMIN - UNIFIED COUPON MANAGEMENT", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/coupons", styles['URL']))
    story.append(Paragraph("Single unified system for both sports and cafe coupons:", styles['Body']))
    story.append(Paragraph("- Scope: Sports only, Cafe only, or Both", styles['Body']))
    story.append(Paragraph("- Type: Percentage (with optional max cap) or Flat amount", styles['Body']))
    story.append(Paragraph("- Filters: sport filter, cafe category filter", styles['Body']))
    story.append(Paragraph("- User groups: First-time, Premium Player (10+ bookings), Frequent Visitor (5+ orders), Birthday Month", styles['Body']))
    story.append(Paragraph("- Conditions: minimum amount, time window (flash deals), first purchase", styles['Body']))
    story.append(Paragraph("- Stackable coupons: allow percentage + flat together", styles['Body']))
    story.append(Paragraph("- Public toggle: visible on /coupons page", styles['Body']))
    story.append(Paragraph("- Usage tracking per user per order", styles['Body']))

    story.append(PageBreak())

    # ============ SECTION 16: BANNERS & FAQ ============
    story.append(Paragraph("16. ADMIN - BANNERS & FAQs", styles['SectionTitle']))
    story.append(Paragraph("Banners (/admin/banners): Promo banners on booking pages (BOOK_PAGE, SLOT_SELECTION, CHECKOUT)", styles['Body']))
    story.append(Paragraph("FAQs (/admin/faqs): Manage FAQ entries with categories, keywords, sort order", styles['Body']))

    # ============ SECTION 17: CAFE MENU ============
    story.append(Paragraph("17. ADMIN - CAFE MENU MANAGEMENT", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/cafe-menu", styles['URL']))
    story.append(Paragraph("- CRUD for menu items: name, description, category, price, image, veg/non-veg", styles['Body']))
    story.append(Paragraph("- Tags: Popular, Bestseller, New, Spicy, Cold, Hot", styles['Body']))
    story.append(Paragraph("- Toggle availability (in-stock/out-of-stock)", styles['Body']))
    story.append(Paragraph("- Sort order within categories", styles['Body']))
    story.append(Paragraph("- Search items by name", styles['Body']))

    # ============ SECTION 18: CAFE ORDERS & LIVE ============
    story.append(Paragraph("18. ADMIN - CAFE ORDERS & LIVE DASHBOARD", styles['SectionTitle']))

    story.append(Paragraph("18.1 Cafe Orders", styles['SubSection']))
    story.append(Paragraph("URL: /admin/cafe-orders", styles['URL']))
    story.append(Paragraph("- Order list with filters: status, date, search", styles['Body']))
    story.append(Paragraph("- Stats: today's orders, revenue, pending count, popular items", styles['Body']))
    story.append(Paragraph("- Status workflow: PENDING -> PREPARING -> READY -> COMPLETED", styles['Body']))
    story.append(Paragraph("- Admin can create orders for walk-in customers", styles['Body']))

    story.append(Paragraph("18.2 Live Orders (Kitchen Display)", styles['SubSection']))
    story.append(Paragraph("URL: /admin/cafe-live", styles['URL']))
    story.append(Paragraph("- Kanban board: 3 columns (Pending, Preparing, Ready)", styles['Body']))
    story.append(Paragraph("- Each card: order#, table badge, items, elapsed time, action button", styles['Body']))
    story.append(Paragraph("- Auto-refreshes every 10 seconds", styles['Body']))
    story.append(Paragraph("- Sound notification on new orders (with mute toggle)", styles['Body']))
    story.append(Paragraph("- Fullscreen mode for dedicated KDS tablet", styles['Body']))
    story.append(Paragraph("- One-click status advancement buttons", styles['Body']))

    story.append(Paragraph("MANUAL TEST: Live Orders", styles['SubSubSection']))
    story.append(Paragraph("1. Open /admin/cafe-live in one tab", styles['TestStep']))
    story.append(Paragraph("2. Place a cafe order from /cafe in another tab", styles['TestStep']))
    story.append(Paragraph("3. Verify order appears in PENDING column within 10 seconds", styles['TestStep']))
    story.append(Paragraph("4. Click 'Start Preparing' -> verify moves to PREPARING column", styles['TestStep']))
    story.append(Paragraph("5. Click 'Mark Ready' -> verify moves to READY column", styles['TestStep']))
    story.append(Paragraph("6. Click 'Complete' -> verify order disappears from board", styles['TestStep']))
    story.append(Paragraph("7. Test fullscreen mode -> verify admin nav hidden", styles['TestStep']))
    story.append(Paragraph("Expected: Real-time updates, status flow works, table number visible", styles['Expected']))

    story.append(PageBreak())

    # ============ SECTION 19: ANALYTICS ============
    story.append(Paragraph("19. ADMIN - ANALYTICS DASHBOARD", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/analytics", styles['URL']))
    story.append(Paragraph("Multi-level filters: date range, scope (All/Sports/Cafe), group by (Day/Week/Month)", styles['Body']))

    story.append(Paragraph("19.1 KPI Cards", styles['SubSection']))
    story.append(Paragraph("Total Revenue, Sports Revenue, Cafe Revenue, Total Bookings, Avg Booking Value, Cancellation Rate", styles['Body']))

    story.append(Paragraph("19.2 Charts (Recharts)", styles['SubSection']))
    story.append(Paragraph("- Revenue over time (line chart - sports, cafe, total lines)", styles['Body']))
    story.append(Paragraph("- Sport-wise revenue (pie chart)", styles['Body']))
    story.append(Paragraph("- Cafe category revenue (pie chart)", styles['Body']))
    story.append(Paragraph("- Peak booking hours (bar chart)", styles['Body']))
    story.append(Paragraph("- Payment method breakdown (donut chart)", styles['Body']))
    story.append(Paragraph("- Top customers table", styles['Body']))

    # ============ SECTION 20: REWARDS CONFIG ============
    story.append(Paragraph("20. ADMIN - REWARD POINTS CONFIG", styles['SectionTitle']))
    story.append(Paragraph("URL: /admin/rewards", styles['URL']))

    story.append(Paragraph("20.1 Config Tab (All Admin-Configurable)", styles['SubSection']))
    config_data = [
        ["Setting", "Default", "Description"],
        ["Sports earn rate", "1 pt/Rs.1", "Points earned per rupee on bookings"],
        ["Cafe earn rate", "2 pt/Rs.1", "Points earned per rupee on cafe orders"],
        ["Redeem rate", "10 pts = Rs.1", "Points needed per rupee discount"],
        ["Min redeem", "100 points", "Minimum points to redeem"],
        ["Max redeem %", "50%", "Maximum discount from points per order"],
        ["Referral bonus", "100 points", "Points for referrer + referred"],
        ["Point expiry", "365 days", "Days until points expire"],
        ["Silver threshold", "500 pts", "Lifetime earned for Silver (1.25x)"],
        ["Gold threshold", "2000 pts", "Lifetime earned for Gold (1.5x)"],
        ["Platinum threshold", "5000 pts", "Lifetime earned for Platinum (2x)"],
    ]
    config_table = Table(config_data, colWidths=[35*mm, 30*mm, 95*mm])
    config_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('BACKGROUND', (0, 0), (-1, 0), EMERALD),
        ('GRID', (0, 0), (-1, -1), 0.5, ZINC_400),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(config_table)

    story.append(Paragraph("20.2 Users Tab: Search users, view/adjust points manually", styles['Body']))
    story.append(Paragraph("20.3 Stats Tab: Total circulation, tier distribution, top earners", styles['Body']))

    story.append(PageBreak())

    # ============ SECTION 21: RAZORPAY & ADMIN USERS ============
    story.append(Paragraph("21. ADMIN - RAZORPAY & ADMIN USERS", styles['SectionTitle']))

    story.append(Paragraph("21.1 Razorpay Dashboard", styles['SubSection']))
    story.append(Paragraph("URL: /admin/razorpay", styles['URL']))
    story.append(Paragraph("- Payment overview from Razorpay API", styles['Body']))
    story.append(Paragraph("- Transaction history", styles['Body']))

    story.append(Paragraph("21.2 Admin Users", styles['SubSection']))
    story.append(Paragraph("URL: /admin/admin-users (Superadmin only)", styles['URL']))
    story.append(Paragraph("- Create new admin users with granular permissions", styles['Body']))
    story.append(Paragraph("- Invite via email with set-password link (24hr expiry)", styles['Body']))
    story.append(Paragraph("- Permissions: MANAGE_BOOKINGS, MANAGE_PRICING, MANAGE_SLOTS, MANAGE_SPORTS, MANAGE_USERS, MANAGE_DISCOUNTS, MANAGE_BANNERS, MANAGE_FAQS, VIEW_ANALYTICS, VIEW_RAZORPAY, MANAGE_CAFE_MENU, MANAGE_CAFE_ORDERS, MANAGE_REWARDS, MANAGE_COUPONS", styles['Body']))
    story.append(Paragraph("- Superadmin password change notifies recovery emails", styles['Body']))
    story.append(Paragraph("- Recovery emails: y12.nakul@gmail.com, tangrianand@gmail.com, saxenautkarsh193@gmail.com", styles['Body']))

    # ============ SECTION 22: INVOICES ============
    story.append(Paragraph("22. INVOICE & PDF GENERATION", styles['SectionTitle']))

    story.append(Paragraph("22.1 Sports Booking Invoice", styles['SubSection']))
    story.append(Paragraph("- Generated on demand (Download Invoice button)", styles['Body']))
    story.append(Paragraph("- On company letterhead (letterhead.png)", styles['Body']))
    story.append(Paragraph("- Contains: Invoice#, date, Bill To, From (GSTIN: 09AFWFS2503M1ZB)", styles['Body']))
    story.append(Paragraph("- Booking details: ID, sport, court, date, time, payment info", styles['Body']))
    story.append(Paragraph("- Line items table: S.No, Description, Hours, Rate, Amount", styles['Body']))
    story.append(Paragraph("- GST: 18% inclusive (9% CGST + 9% SGST)", styles['Body']))
    story.append(Paragraph("- Amount in words, Terms & Conditions", styles['Body']))

    story.append(Paragraph("22.2 Cafe Order Invoice", styles['SubSection']))
    story.append(Paragraph("- Same letterhead and GST format as sports invoice", styles['Body']))
    story.append(Paragraph("- Items table with quantities and unit prices", styles['Body']))

    story.append(Paragraph("22.3 Cafe Menu PDF", styles['SubSection']))
    story.append(Paragraph("URL: /api/cafe-menu-pdf (public, no auth)", styles['URL']))
    story.append(Paragraph("- Dark amber theme, Momentum Arena logo", styles['Body']))
    story.append(Paragraph("- Category icons (clipart), item cards with veg/non-veg, tags, prices", styles['Body']))
    story.append(Paragraph("- Multi-page support with continuation headers", styles['Body']))

    story.append(PageBreak())

    # ============ SECTION 23: ENV & CONFIG ============
    story.append(Paragraph("23. ENVIRONMENT & CONFIGURATION", styles['SectionTitle']))

    env_data = [
        ["Variable", "Purpose"],
        ["DATABASE_URL", "PostgreSQL connection (Neon)"],
        ["AUTH_SECRET", "NextAuth JWT signing key"],
        ["GOOGLE_CLIENT_ID", "Google OAuth client ID"],
        ["GOOGLE_CLIENT_SECRET", "Google OAuth secret"],
        ["MSG91_AUTH_KEY", "MSG91 for OTP emails"],
        ["RAZORPAY_KEY_ID", "Razorpay API key"],
        ["RAZORPAY_KEY_SECRET", "Razorpay API secret"],
        ["CRON_SECRET", "Auth for cron endpoints"],
        ["NEXTAUTH_URL", "Base URL for auth callbacks"],
    ]
    env_table = Table(env_data, colWidths=[50*mm, 110*mm])
    env_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('BACKGROUND', (0, 0), (-1, 0), EMERALD_DARK),
        ('GRID', (0, 0), (-1, -1), 0.5, ZINC_400),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('FONTNAME', (0, 1), (0, -1), 'Courier'),
        ('FONTSIZE', (0, 1), (0, -1), 8),
    ]))
    story.append(env_table)

    story.append(Spacer(1, 10*mm))
    story.append(Paragraph("Deployments:", styles['SubSection']))
    story.append(Paragraph("- Production: momentumarena.com (Vercel, main branch)", styles['Body']))
    story.append(Paragraph("- Staging: development.momentumarena.com (Vercel, development branch)", styles['Body']))
    story.append(Paragraph("- Local: localhost:3000", styles['Body']))

    story.append(Spacer(1, 10*mm))
    story.append(Paragraph("Tech Stack:", styles['SubSection']))
    story.append(Paragraph("Next.js 16 (App Router) | TypeScript | Tailwind CSS | Prisma ORM | PostgreSQL (Neon) | NextAuth v5 | Razorpay | Recharts | jsPDF | MSG91", styles['Body']))

    story.append(Spacer(1, 15*mm))
    story.append(Paragraph("--- END OF DOCUMENT ---", ParagraphStyle(
        name='EndDoc',
        parent=styles['Normal'],
        fontSize=10,
        textColor=ZINC_400,
        alignment=TA_CENTER,
    )))

    # Build
    doc.build(story)
    print(f"PDF generated: {output_path}")

if __name__ == "__main__":
    build_pdf()
