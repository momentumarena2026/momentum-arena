-- Per-method enable flags on the singleton PaymentGatewayConfig row.
-- All default TRUE so behavior doesn't change until an admin toggles one off.

ALTER TABLE "PaymentGatewayConfig"
  ADD COLUMN IF NOT EXISTS "onlineEnabled"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "upiQrEnabled"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "advanceEnabled"  BOOLEAN NOT NULL DEFAULT true;
