# PhonePe Dynamic QR (DQR) — reference

> **Status (July 2026): LIVE in production.** DQR is the default "Pay by
> UPI" path on web + both apps — per-order dynamic QR / UPI-intent deep
> links with **automatic** confirmation (S2S callback + status polling).
> The onboarding checklist below is kept for reference (e.g. adding a new
> store/terminal or re-provisioning).

## Current configuration

- **Env vars** (Vercel): `PHONEPE_DQR_MERCHANT_ID`, `PHONEPE_DQR_SALT_KEY`,
  `PHONEPE_DQR_SALT_INDEX`, plus five per-store IDs
  (`PHONEPE_DQR_STORE_ID_ONLINE/_OFFLINE/_GYM/_YOGA/_CAFE`; the online store
  is the one used for checkout). `PHONEPE_DQR_ENV` selects the host
  (`mercury-uat` sandbox vs `mercury-t2` production).
- **Admin controls** (`/admin/payment-settings` → UPI QR): Static QR vs
  Dynamic QR are mutually exclusive; Dynamic QR has a nested **UPI Intent**
  toggle (tappable app list vs scan-only). *The old `PHONEPE_DQR_MODE` env
  var is retired — mode is a DB toggle now.*
- **Records**: DQR payments land as `Payment.method = UPI_QR`,
  `confirmedBy = "PHONEPE_DQR"`, our `transactionId` in
  `phonePeMerchantTxnId`. Reconciliation is by transactionId (not UTR).
- **Fallback**: the static-QR + manual-UTR flow remains available as the
  admin-selectable Static mode (`/admin/utr-verify`).

## Known-pending with PhonePe (as of July 2026)

- **Transaction-list API** (`/v3/qr/transaction/list`) is not yet
  provisioned on the merchant — requests fail with 500 /
  `INVALID_PROVIDER_MAPPING`. The admin PhonePe dashboard therefore reads
  from our own DB. Ticket open with PhonePe; the API plumbing is built and
  dormant.
- **UPI Intent on new VPAs** can take ~24–48h of NPCI replication after
  PhonePe enables Open Intent — if intent links error with "payment through
  a link is not allowed", wait out replication before escalating.

## Onboarding checklist (for a new merchant/store)

1. Ask the PhonePe account manager to **enable the DQR Init API**
   (`/v3/qr/init`) and, if intent is wanted, **Open Intent** on the VPA.
2. Collect: DQR **Merchant ID**, **salt key + index** (V1 signing),
   **Store ID(s)** (mandatory; optional Terminal ID per terminal).
3. **Register the callback URL**:
   `https://<domain>/api/phonepe/dqr-callback` (PhonePe POSTs
   `{ response: base64 }` with an `X-VERIFY` header).
4. Request **UAT access** (`mercury-uat.phonepe.com`) for an end-to-end
   sandbox test before production.
5. Set the env vars (sandbox values on Preview, production on Production),
   redeploy, then flip Dynamic QR on in `/admin/payment-settings` and run a
   test payment — it should auto-confirm.
