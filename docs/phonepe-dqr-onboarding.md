# PhonePe Dynamic QR (DQR) — onboarding checklist

The code for DQR ("Pay by UPI" → a per-order dynamic QR with the amount
baked in and **automatic** confirmation) is built and deployed, but
**dormant**. It activates only when both of these are true:

1. The `PHONEPE_DQR_*` env vars are set (see `.env.example`), and
2. An admin turns it on at **/admin/payment-settings → UPI Payment Mode**.

Until then, "Pay by UPI" keeps using the existing static QR + manual-UTR
flow, so nothing changes for customers.

This is the dynamic sibling of the static-QR product we already use, so
we're likely already on the right PhonePe merchant type — but DQR Init
must be explicitly provisioned. **This is the only blocker; it's an
account/contract task, not a code task.**

## What to ask your PhonePe account manager

1. **Enable the DQR Init API** (`/v3/qr/init`) on our merchant account
   — the offline/enterprise "Dynamic QR" product.
2. Provide / confirm:
   - **Merchant ID** for DQR → `PHONEPE_DQR_MERCHANT_ID`
   - **Salt key + salt index** (V1 signing) → `PHONEPE_DQR_SALT_KEY`,
     `PHONEPE_DQR_SALT_INDEX`
   - **Store ID** (mandatory) and, if we want per-terminal reporting,
     a **Terminal ID** → `PHONEPE_DQR_STORE_ID`, `PHONEPE_DQR_TERMINAL_ID`
3. **Register the callback URL** for payment notifications:
   `https://<our-domain>/api/phonepe/dqr-callback`
   (PhonePe POSTs `{ response: base64 }` with an `X-VERIFY` header.)
4. **Grant UAT/sandbox access** (`mercury-uat.phonepe.com`) so we can run
   an end-to-end test before flipping production on.

## Activation steps (once the above is done)

1. Set the `PHONEPE_DQR_*` vars on Vercel — sandbox values on
   Preview/Development, production values on Production.
   (`PHONEPE_ENV` already selects the host: `SANDBOX` → mercury-uat,
   `PRODUCTION` → mercury-t2.)
2. Redeploy.
3. On `/admin/payment-settings`, the "Dynamic QR" toggle stops showing
   the "credentials not configured" warning — turn it on.
4. Run a test booking/cafe order via "Pay by UPI": a real QR should
   render, and on payment the order should auto-confirm (callback +
   status poll).

## Notes for whoever activates it

- Confirm against the sandbox that the DQR Init **request body wrapping**
  (`{ request: <base64> }`) and the **status/callback checksum** strings
  match what PhonePe returns — `lib/phonepe-dqr.ts` documents the two
  spots flagged for verification.
- DQR records land as `Payment.method = UPI_QR`, `confirmedBy =
  "PHONEPE_DQR"`, with our `transactionId` in `phonePeMerchantTxnId`.
- Reconciliation is by `transactionId` (not UTR), so the manual-UTR /
  WhatsApp-screenshot path is no longer needed once DQR is on (it stays
  as a fallback).
