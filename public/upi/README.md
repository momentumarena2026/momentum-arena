# UPI app logos

Brand icons for the UPI intent sheet (components/payment/dqr-checkout.tsx
on web; apps/mobile/src/components/payment/DqrCheckout.tsx keeps an
identical copy under apps/mobile/src/assets/upi/).

All icons are 128x128 PNG on a white chip, extracted from
`UPI_icons.jpeg` (the master sprite) by `README`-documented grid crop.
PNG is mandatory: React Native on iOS does not render .webp, which made
the earlier logos invisible in the app.

Current set (popularity order used in the sheet):
phonepe · gpay · paytm · bhim · amazonpay · cred · mobikwik · whatsapp ·
navi — plus `upi.png` (generic mark, used by the static-QR flow).

To add an app: crop it from UPI_icons.jpeg (or a square brand icon),
save as 128x128 PNG here AND in apps/mobile/src/assets/upi/, then add
the entry (name, deep-link scheme, icon) to the UPI_APPS lists in both
checkout components.
