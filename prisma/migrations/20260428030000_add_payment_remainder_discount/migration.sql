-- Add a third leg to the venue-side split collection: an optional
-- on-the-spot discount the floor staff can apply at collection time
-- (e.g. ₹100 goodwill cut for a regular). The three remainder-split
-- amounts (cash, UPI, discount) sum to the remainder that was owed.
-- `Payment.amount` continues to reflect only what was actually
-- collected — the discount portion does NOT count as paid.
--
-- Existing rows keep this column null. The display layer treats null
-- and 0 as equivalent (no discount applied).
ALTER TABLE "Payment"
  ADD COLUMN "remainderDiscountAmount" INTEGER;
