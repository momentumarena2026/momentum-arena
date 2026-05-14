-- Bowling Machine practice — Phase 1 (schema + seed)
-- ─────────────────────────────────────────────────────────────────
-- 1. New BookingCategory enum
-- 2. Column additions on CourtConfig / BookingSlot / SlotHold /
--    SlotBlock / Booking / Coupon / DiscountCode / RecurringBooking /
--    Equipment
-- 3. OperatingWindow model
-- 4. Seed:
--    - Bowling-machine CourtConfig (sport=CRICKET, size=BOWLING_MACHINE
--      reuses ConfigSize. Width 10ft, length 90ft, zones = LEFT half
--      by default — admin can flip via /admin/sports later)
--    - 3 equipment items (kit ₹100, bat ₹100, L-guard ₹50)
--    - Default operating windows (weekdays 5am–4pm; weekends
--      5–7am + 12pm–4pm)
--    - Mark the active new-user system DiscountCode with
--      categoryExclude = {BOWLING_MACHINE}

-- ── 1. New enum ─────────────────────────────────────────────────
CREATE TYPE "BookingCategory" AS ENUM ('BOX_CRICKET', 'BOWLING_MACHINE');

-- ── 2a. CourtConfig column adds ─────────────────────────────────
ALTER TABLE "CourtConfig"
  ADD COLUMN IF NOT EXISTS "category" "BookingCategory",
  ADD COLUMN IF NOT EXISTS "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60;

-- Backfill existing CRICKET configs as BOX_CRICKET so coupon /
-- analytics filters that look at category never see NULL on cricket.
UPDATE "CourtConfig"
   SET "category" = 'BOX_CRICKET'
 WHERE "sport" = 'CRICKET' AND "category" IS NULL;

-- ── 2b. BookingSlot column adds ──────────────────────────────────
-- The existing @@unique([bookingId, startHour]) is replaced by a
-- triple-key unique that also includes startMinute, so the same
-- hour can hold both a :00 and :30 booking for the bowling court.
ALTER TABLE "BookingSlot"
  ADD COLUMN IF NOT EXISTS "startMinute" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "BookingSlot"
  DROP CONSTRAINT IF EXISTS "BookingSlot_bookingId_startHour_key";

ALTER TABLE "BookingSlot"
  ADD CONSTRAINT "BookingSlot_bookingId_startHour_startMinute_key"
  UNIQUE ("bookingId", "startHour", "startMinute");

-- ── 2c. SlotHold column adds ─────────────────────────────────────
ALTER TABLE "SlotHold"
  ADD COLUMN IF NOT EXISTS "startMinutes" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "equipmentSelection" JSONB,
  ADD COLUMN IF NOT EXISTS "equipmentTotalAmount" INTEGER;

-- ── 2d. SlotBlock column ─────────────────────────────────────────
ALTER TABLE "SlotBlock"
  ADD COLUMN IF NOT EXISTS "startMinute" INTEGER NOT NULL DEFAULT 0;

-- ── 2e. Booking column adds ──────────────────────────────────────
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "category" "BookingCategory",
  ADD COLUMN IF NOT EXISTS "equipmentTotalAmount" INTEGER NOT NULL DEFAULT 0;

-- ── 2f. Coupon / DiscountCode column adds ────────────────────────
ALTER TABLE "Coupon"
  ADD COLUMN IF NOT EXISTS "categoryExclude" "BookingCategory"[] NOT NULL DEFAULT '{}';

ALTER TABLE "DiscountCode"
  ADD COLUMN IF NOT EXISTS "categoryExclude" "BookingCategory"[] NOT NULL DEFAULT '{}';

-- ── 2g. RecurringBooking column adds ─────────────────────────────
ALTER TABLE "RecurringBooking"
  ADD COLUMN IF NOT EXISTS "startMinute" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "endMinute" INTEGER NOT NULL DEFAULT 0;

-- ── 2h. Equipment column adds ────────────────────────────────────
ALTER TABLE "Equipment"
  ADD COLUMN IF NOT EXISTS "category" "BookingCategory",
  ADD COLUMN IF NOT EXISTS "isCustomerSelectable" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- ── 3. OperatingWindow model ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OperatingWindow" (
    "id" TEXT NOT NULL,
    "courtConfigId" TEXT NOT NULL,
    "dayType" "DayType" NOT NULL,
    "startHour" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL DEFAULT 0,
    "endHour" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperatingWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OperatingWindow_courtConfigId_dayType_idx"
  ON "OperatingWindow"("courtConfigId", "dayType");

ALTER TABLE "OperatingWindow"
  ADD CONSTRAINT "OperatingWindow_courtConfigId_fkey"
  FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. Seed the bowling-machine court config ─────────────────────
-- Reuses ConfigSize.SHARED (no need to extend the enum) — paired with
-- a unique `position = "BOWLING_MACHINE"` value the rest of the code
-- can pattern-match on. Zones default to LEATHER_1 + BOX_A (i.e. the
-- LEFT half) so any LEFT or FULL booking automatically blocks the
-- machine and vice-versa, per the spec. Admin can flip the side via
-- /admin/sports.
INSERT INTO "CourtConfig" (
  "id", "sport", "size", "label", "position",
  "widthFt", "lengthFt", "zones", "category",
  "slotDurationMinutes", "isActive",
  "createdAt", "updatedAt"
)
VALUES (
  'bowling_machine_court',
  'CRICKET',
  'SHARED',
  'Bowling Machine',
  'BOWLING_MACHINE',
  10,
  90,
  ARRAY['LEATHER_1', 'BOX_A']::"CourtZone"[],
  'BOWLING_MACHINE',
  30,
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT ("sport", "size", "position") DO UPDATE SET
  "category" = EXCLUDED."category",
  "slotDurationMinutes" = EXCLUDED."slotDurationMinutes",
  "widthFt" = EXCLUDED."widthFt",
  "lengthFt" = EXCLUDED."lengthFt",
  "label" = EXCLUDED."label";

-- ── 4b. Default operating windows for the bowling court ──────────
-- WEEKDAYS:  5am – 4pm (single window)
-- WEEKENDS:  5–7am + 12pm – 4pm (two disjoint windows)
INSERT INTO "OperatingWindow" (
  "id", "courtConfigId", "dayType",
  "startHour", "startMinute", "endHour", "endMinute",
  "sortOrder", "createdAt", "updatedAt"
)
VALUES
  ('ow_bm_wd_1',  'bowling_machine_court', 'WEEKDAY',  5,  0, 16, 0, 0, NOW(), NOW()),
  ('ow_bm_we_1',  'bowling_machine_court', 'WEEKEND',  5,  0,  7, 0, 0, NOW(), NOW()),
  ('ow_bm_we_2',  'bowling_machine_court', 'WEEKEND', 12,  0, 16, 0, 1, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- ── 4c. Default pricing rule ─────────────────────────────────────
-- ₹250 per 30-min slot, off-peak weekdays + weekends. Admin can edit
-- in /admin/pricing post-deploy.
INSERT INTO "PricingRule" (
  "id", "courtConfigId", "dayType", "timeType", "pricePerSlot"
)
VALUES
  ('pr_bm_wd_off', 'bowling_machine_court', 'WEEKDAY', 'OFF_PEAK', 250),
  ('pr_bm_wd_peak','bowling_machine_court', 'WEEKDAY', 'PEAK',     250),
  ('pr_bm_we_off', 'bowling_machine_court', 'WEEKEND', 'OFF_PEAK', 250),
  ('pr_bm_we_peak','bowling_machine_court', 'WEEKEND', 'PEAK',     250)
ON CONFLICT DO NOTHING;

-- ── 4d. Equipment items (kit, bat, L-guard) ──────────────────────
-- pricePerHour kept as the historical column name but actually
-- represents a flat per-booking ₹ price (paise). The seed values
-- match the spec: kit ₹100, bat ₹100, L-guard ₹50.
INSERT INTO "Equipment" (
  "id", "name", "sport", "category",
  "pricePerHour", "totalUnits", "availableUnits",
  "isActive", "isCustomerSelectable", "displayOrder",
  "createdAt", "updatedAt"
)
VALUES
  (
    'eq_bm_kit', 'Batting kit', 'CRICKET', 'BOWLING_MACHINE',
    100, 5, 5, TRUE, TRUE, 0, NOW(), NOW()
  ),
  (
    'eq_bm_bat', 'Bat', 'CRICKET', 'BOWLING_MACHINE',
    100, 5, 5, TRUE, TRUE, 1, NOW(), NOW()
  ),
  (
    'eq_bm_lguard', 'L-guard + supporter', 'CRICKET', 'BOWLING_MACHINE',
    50, 5, 5, TRUE, TRUE, 2, NOW(), NOW()
  )
ON CONFLICT ("id") DO NOTHING;

-- ── 4e. New-user discount auto-excludes bowling ──────────────────
-- The active system new-user code never applies to bowling-machine
-- bookings. Admins can re-enable by editing the row.
UPDATE "DiscountCode"
   SET "categoryExclude" = ARRAY['BOWLING_MACHINE']::"BookingCategory"[]
 WHERE "isSystemCode" = TRUE
   AND "isActive" = TRUE
   AND 'BOWLING_MACHINE' <> ALL("categoryExclude");
