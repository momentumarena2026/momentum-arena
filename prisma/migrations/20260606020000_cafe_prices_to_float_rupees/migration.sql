-- Move every cafe price/amount column from `Int (paise)` →
-- `Float (rupees)` with a one-shot ÷100 cast so existing data
-- preserves its actual value. The schema + form mismatch was
-- breaking displays — admins typed "150" on the create form, the
-- form ×100'd to 15000 paise, formatPrice() (which never divided)
-- rendered ₹15,000. Going rupee-native everywhere makes the
-- admin form, list display, and reports consistent; gateway
-- adapters (Razorpay create-order, PhonePe initiate) ×100 at the
-- boundary.
--
-- USING clause keeps existing rows correct: 15000 paise → 150.00 ₹.
-- New rows from the fixed form will store directly in rupees.

ALTER TABLE "CafeItem"
  ALTER COLUMN "price"     TYPE DOUBLE PRECISION USING ("price"::double precision / 100),
  ALTER COLUMN "costPrice" TYPE DOUBLE PRECISION USING ("costPrice"::double precision / 100);

ALTER TABLE "CafeOrderItem"
  ALTER COLUMN "unitPrice"  TYPE DOUBLE PRECISION USING ("unitPrice"::double precision / 100),
  ALTER COLUMN "totalPrice" TYPE DOUBLE PRECISION USING ("totalPrice"::double precision / 100);

ALTER TABLE "CafeOrder"
  ALTER COLUMN "totalAmount"    TYPE DOUBLE PRECISION USING ("totalAmount"::double precision / 100),
  ALTER COLUMN "originalAmount" TYPE DOUBLE PRECISION USING ("originalAmount"::double precision / 100),
  ALTER COLUMN "discountAmount" TYPE DOUBLE PRECISION USING ("discountAmount"::double precision / 100);

ALTER TABLE "CafePayment"
  ALTER COLUMN "amount" TYPE DOUBLE PRECISION USING ("amount"::double precision / 100);

-- CafeDiscount.value is a polymorphic column — basis points for
-- PERCENTAGE rows, rupee amount for FLAT rows. Two-step: relax
-- the column type to Float first, then ÷100 the FLAT rows only.
-- PERCENTAGE values stay as integer basis-point counts that
-- happen to round-trip cleanly through Float.
ALTER TABLE "CafeDiscount"
  ALTER COLUMN "value" TYPE DOUBLE PRECISION USING ("value"::double precision),
  ALTER COLUMN "minOrderAmount" TYPE DOUBLE PRECISION USING ("minOrderAmount"::double precision / 100);

UPDATE "CafeDiscount" SET "value" = "value" / 100 WHERE "type" = 'FLAT';

ALTER TABLE "CafeDiscountUsage"
  ALTER COLUMN "discountAmount" TYPE DOUBLE PRECISION USING ("discountAmount"::double precision / 100);

ALTER TABLE "CafeOrderEditHistory"
  ALTER COLUMN "previousAmount" TYPE DOUBLE PRECISION USING ("previousAmount"::double precision / 100),
  ALTER COLUMN "newAmount"      TYPE DOUBLE PRECISION USING ("newAmount"::double precision / 100);
