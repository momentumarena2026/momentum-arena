-- Idempotent pre-`prisma db push` cleanup.
--
-- `prisma db push` can't remove an enum value on its own when rows still
-- reference it: the internal ALTER TYPE ... USING "col"::text::"Sport_new"
-- cast fails on any row carrying a value that no longer exists in the new
-- enum. So before `db push` runs, we purge every row that would block the
-- enum rebuild. Each block is wrapped in a `pg_enum` existence check so it
-- becomes a strict no-op once the value has been dropped.
--
-- Add future one-time cleanups here; workflows run this file before
-- `npx prisma db push` on every deploy.

-- ---- Sport enum: BADMINTON removal (2026-04) ----
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Sport' AND e.enumlabel = 'BADMINTON'
  ) THEN
    -- Tables with a non-cascading FK to CourtConfig.
    DELETE FROM "PricingRule"
      WHERE "courtConfigId" IN (SELECT "id" FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON');
    DELETE FROM "SlotHold"
      WHERE "courtConfigId" IN (SELECT "id" FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON');
    DELETE FROM "Booking"
      WHERE "courtConfigId" IN (SELECT "id" FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON');
    DELETE FROM "SlotBlock"
      WHERE "courtConfigId" IN (SELECT "id" FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON');
    DELETE FROM "Waitlist"
      WHERE "courtConfigId" IN (SELECT "id" FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON');
    DELETE FROM "RecurringBooking"
      WHERE "courtConfigId" IN (SELECT "id" FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON');

    -- CourtConfig rows themselves.
    DELETE FROM "CourtConfig" WHERE "sport"::text = 'BADMINTON';

    -- Tables that reference the Sport enum directly.
    DELETE FROM "SlotBlock" WHERE "sport"::text = 'BADMINTON';
    DELETE FROM "Equipment" WHERE "sport"::text = 'BADMINTON';

    -- Array columns: strip the value; cast existing column via text to stay
    -- valid even if the enum has already been rebuilt on a later run.
    UPDATE "DiscountCode"
      SET "sportFilter" = array_remove("sportFilter", 'BADMINTON'::"Sport")
      WHERE 'BADMINTON' = ANY("sportFilter"::text[]);
    UPDATE "Coupon"
      SET "sportFilter" = array_remove("sportFilter", 'BADMINTON'::"Sport")
      WHERE 'BADMINTON' = ANY("sportFilter"::text[]);
  END IF;
END $$;

-- ---- Coupon.minAmount: paise → rupees one-shot (2026-05) ----
-- The admin form historically stored this as paise (placeholder
-- "50000 = ₹500"). The validator compared it against rupees, and
-- the display chips treated it as rupees too — so the stored value
-- was off by 100× from what admins intended. Divide existing rows
-- once. Idempotency uses a Postgres COMMENT ON COLUMN marker — db
-- push doesn't strip column comments, so once set, this block is
-- a strict no-op forever.
DO $$
BEGIN
  IF (
    SELECT pg_catalog.col_description('"Coupon"'::regclass::oid, attnum)
    FROM pg_attribute
    WHERE attrelid = '"Coupon"'::regclass AND attname = 'minAmount'
  ) IS DISTINCT FROM 'rupees:1.0' THEN
    UPDATE "Coupon"
      SET "minAmount" = "minAmount" / 100
      WHERE "minAmount" IS NOT NULL AND "minAmount" > 0;
    COMMENT ON COLUMN "Coupon"."minAmount" IS 'rupees:1.0';
  END IF;
END $$;

-- ---- ReportType enum: CAFE_ITEM_SALES_MONTHLY removal (2026-07) ----
-- The standalone CA cafe item-sales report was merged into CA_MONTHLY
-- as a workbook sheet the same week it shipped. Purge any Report rows
-- generated under the short-lived type so `db push` can rebuild the
-- enum without them blocking the cast. No-op once the value is gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ReportType' AND e.enumlabel = 'CAFE_ITEM_SALES_MONTHLY'
  ) THEN
    DELETE FROM "Report" WHERE "type"::text = 'CAFE_ITEM_SALES_MONTHLY';
  END IF;
END $$;
