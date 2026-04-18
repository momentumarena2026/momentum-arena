-- Partial-payment data model additions:
--   1. PaymentStatus gains a PARTIAL value (advance in, remainder owed).
--   2. Payment gets a remainderMethod column capturing how the venue-side
--      remainder was collected (CASH or UPI_QR) when markRemainderCollected
--      runs. The existing `method` column continues to represent the
--      advance method.
-- Both additions are idempotent so re-running the migration is a no-op.

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIAL' BEFORE 'COMPLETED';

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "remainderMethod" "PaymentMethod";
