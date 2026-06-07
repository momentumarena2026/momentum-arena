-- ArenaSettings singleton. Replaces the hardcoded
-- OPERATING_HOURS constant in lib/court-config.ts. Edited from
-- /admin/pricing; read by every slot-availability / pricing path.
CREATE TABLE "ArenaSettings" (
    "id" TEXT NOT NULL,
    "openHour" INTEGER NOT NULL DEFAULT 5,
    "closeHour" INTEGER NOT NULL DEFAULT 25,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArenaSettings_pkey" PRIMARY KEY ("id")
);

-- Seed a default row using gen_random_uuid() so the first read
-- doesn't have to create-on-miss. Matches the previous
-- hardcoded 5 AM → 1 AM defaults.
INSERT INTO "ArenaSettings" ("id", "openHour", "closeHour", "updatedAt")
VALUES (gen_random_uuid()::text, 5, 25, NOW());
