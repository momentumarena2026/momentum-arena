-- Split remainder collection: a partial-payment booking can now have its
-- venue-side remainder collected as a mix of CASH + UPI_QR. Existing rows
-- keep `remainderMethod` and leave these two columns null so the display
-- layer falls back to the legacy single-method label.
ALTER TABLE "Payment"
  ADD COLUMN "remainderCashAmount" INTEGER,
  ADD COLUMN "remainderUpiAmount"  INTEGER;
