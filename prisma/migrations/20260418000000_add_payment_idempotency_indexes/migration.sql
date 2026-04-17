-- Idempotency-check lookups on webhook retries scale with the Payment and
-- CafePayment table sizes. Without these indexes they degrade to full scans.
-- IF NOT EXISTS is defensive — makes the migration safely re-runnable.

CREATE INDEX IF NOT EXISTS "Payment_razorpayPaymentId_idx"
  ON "Payment"("razorpayPaymentId");

CREATE INDEX IF NOT EXISTS "Payment_phonePeMerchantTxnId_idx"
  ON "Payment"("phonePeMerchantTxnId");

CREATE INDEX IF NOT EXISTS "CafePayment_razorpayPaymentId_idx"
  ON "CafePayment"("razorpayPaymentId");

CREATE INDEX IF NOT EXISTS "CafePayment_phonePeMerchantTxnId_idx"
  ON "CafePayment"("phonePeMerchantTxnId");
