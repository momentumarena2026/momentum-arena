-- Badminton was a coming-soon sport that we never launched. Drop it from
-- the Sport enum so the app, admin filters, and validators stop offering
-- it as a choice.
--
-- Postgres can't DROP VALUE from an enum in-place, so we recreate the type
-- and re-point every column that references it. Any rows using BADMINTON
-- are cleaned up first (there are none in production since bookings on
-- BADMINTON were always blocked by the "Coming Soon" UI, but we guard
-- anyway so the migration is safe to re-run against unknown data).

-- 1. Clean up badminton-only rows where the sport is non-nullable.
DELETE FROM "CourtConfig" WHERE "sport" = 'BADMINTON';

-- 2. Clean up nullable references (admin blocks, equipment) that would
--    otherwise fail the USING cast below.
DELETE FROM "SlotBlock" WHERE "sport" = 'BADMINTON';
DELETE FROM "Equipment" WHERE "sport" = 'BADMINTON';

-- 3. Scrub array columns so array_remove() leaves valid enum values only.
UPDATE "DiscountCode"
  SET "sportFilter" = array_remove("sportFilter", 'BADMINTON'::"Sport")
  WHERE 'BADMINTON' = ANY("sportFilter");
UPDATE "Coupon"
  SET "sportFilter" = array_remove("sportFilter", 'BADMINTON'::"Sport")
  WHERE 'BADMINTON' = ANY("sportFilter");

-- 4. Recreate the Sport enum without BADMINTON.
ALTER TYPE "Sport" RENAME TO "Sport_old";
CREATE TYPE "Sport" AS ENUM ('CRICKET', 'FOOTBALL', 'PICKLEBALL');

-- 5. Repoint every column/array referencing the old type. The USING cast
--    goes via text so Postgres accepts the enum conversion.
ALTER TABLE "CourtConfig"
  ALTER COLUMN "sport" TYPE "Sport" USING "sport"::text::"Sport";

ALTER TABLE "SlotBlock"
  ALTER COLUMN "sport" TYPE "Sport" USING "sport"::text::"Sport";

ALTER TABLE "Equipment"
  ALTER COLUMN "sport" TYPE "Sport" USING "sport"::text::"Sport";

ALTER TABLE "DiscountCode"
  ALTER COLUMN "sportFilter" TYPE "Sport"[] USING "sportFilter"::text[]::"Sport"[];

ALTER TABLE "Coupon"
  ALTER COLUMN "sportFilter" TYPE "Sport"[] USING "sportFilter"::text[]::"Sport"[];

-- 6. Drop the old enum.
DROP TYPE "Sport_old";
