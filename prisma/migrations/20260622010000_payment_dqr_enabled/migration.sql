-- Dynamic QR (DQR) enablement flag for the checkout payment selector.
-- Defaults false so DQR stays dormant until PhonePe onboarding lands
-- the PHONEPE_DQR_* credentials and an admin flips this on.
ALTER TABLE "PaymentGatewayConfig" ADD COLUMN "dqrEnabled" BOOLEAN NOT NULL DEFAULT false;
