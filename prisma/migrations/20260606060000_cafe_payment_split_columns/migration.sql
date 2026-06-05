-- Cafe payment split columns. Mirror the booking-side Payment
-- model exactly: denormalised cash/UPI/discount slices on the
-- single CafePayment row, instead of a separate splits table.
-- Sum of the three slices equals CafeOrder.totalAmount when the
-- payment was settled across multiple methods.
--
-- DROP guard: if a previous dev iteration applied the
-- CafePaymentSplit table from the earlier migration draft, drop
-- it before adding the columns so the dev env converges to the
-- final shape with one apply.
DROP TABLE IF EXISTS "CafePaymentSplit";

ALTER TABLE "CafePayment"
    ADD COLUMN IF NOT EXISTS "splitCashAmount" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "splitUpiAmount" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "splitDiscountAmount" DOUBLE PRECISION;
