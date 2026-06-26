# UPI app logos

Brand logos for the iOS "choose your UPI app" buttons on the DQR checkout
(components/payment/dqr-checkout.tsx → UPI_LOGO_SRC / UpiAppGlyph).

Current files (square brand icons):

- gpay.jpg      — Google Pay
- phonepe.webp  — PhonePe
- paytm.webp    — Paytm
- upi.webp      — generic UPI (the "Other UPI app" tile)

If a file is missing the tile falls back to a brand-coloured mark, so a
missing logo never renders a broken image. To swap a logo, replace the file
and update its path in UPI_LOGO_SRC.
