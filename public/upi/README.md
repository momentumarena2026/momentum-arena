# UPI app logos

Brand logos for the iOS "choose your UPI app" buttons on the DQR checkout
(components/payment/dqr-checkout.tsx → UpiAppGlyph).

Drop these PNGs here (square, ideally ~256×256, transparent or white bg):

- gpay.png     — Google Pay
- phonepe.png  — PhonePe
- paytm.png    — Paytm
- upi.png      — generic UPI (the "Other UPI app" tile)

Until a file is present the tile shows a brand-coloured fallback mark, so
missing files never render a broken image.
