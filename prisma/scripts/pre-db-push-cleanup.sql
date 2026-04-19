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
