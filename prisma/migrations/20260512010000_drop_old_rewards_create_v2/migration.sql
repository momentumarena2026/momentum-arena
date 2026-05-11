-- ─── 1. Drop old reward tables (v1) ───────────────────────────────
-- The old system (RewardPointsBalance / PointsTransaction /
-- RewardConfig / Booking.rewardPointsUsed,Earned /
-- CafeOrder.rewardPointsUsed,Earned / RewardTier /
-- PointsTransactionType) is being replaced wholesale. Cascading FKs
-- on RewardPointsBalance.user → User and PointsTransaction.balance
-- → RewardPointsBalance will drop the rows; explicit DROPs below
-- handle the rest.

DROP TABLE IF EXISTS "PointsTransaction" CASCADE;
DROP TABLE IF EXISTS "RewardPointsBalance" CASCADE;
DROP TABLE IF EXISTS "RewardConfig" CASCADE;
DROP TYPE  IF EXISTS "PointsTransactionType";
DROP TYPE  IF EXISTS "RewardTier";

ALTER TABLE "Booking"   DROP COLUMN IF EXISTS "rewardPointsUsed";
ALTER TABLE "Booking"   DROP COLUMN IF EXISTS "rewardPointsEarned";
ALTER TABLE "CafeOrder" DROP COLUMN IF EXISTS "rewardPointsUsed";
ALTER TABLE "CafeOrder" DROP COLUMN IF EXISTS "rewardPointsEarned";

-- ─── 2. New enums ────────────────────────────────────────────────

CREATE TYPE "RewardTxnType" AS ENUM (
  'EARNED_BOOKING',
  'EARNED_CAFE',
  'EARNED_SIGNUP',
  'EARNED_REFERRAL',
  'EARNED_BIRTHDAY',
  'EARNED_ADJUSTMENT',
  'ADJUSTMENT_REFUND',
  'REDEEMED_BOOKING',
  'REDEEMED_CAFE',
  'REVOKED',
  'EXPIRED',
  'ADJUSTMENT_DEBIT'
);

CREATE TYPE "RewardAlertKind" AS ENUM (
  'RAPID_EARN_REDEEM',
  'HIGH_VELOCITY_EARN',
  'REFUND_THEN_RETAIN',
  'DUPLICATE_PHONE_USERS',
  'BULK_REDEMPTION',
  'NEGATIVE_BALANCE',
  'PARTIAL_REVOKE_SHORTFALL',
  'ADJUSTMENT_AUDIT'
);

CREATE TYPE "RewardAlertStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');
CREATE TYPE "RewardAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- ─── 3. RewardConfig (singleton) ─────────────────────────────────

CREATE TABLE "RewardConfig" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "earnRateBookingBps" INTEGER NOT NULL DEFAULT 200,
  "earnRateCafeBps" INTEGER NOT NULL DEFAULT 500,
  "pointValuePaise" INTEGER NOT NULL DEFAULT 100,
  "minPointsToRedeem" INTEGER NOT NULL DEFAULT 50,
  "maxRedemptionPctOfBill" INTEGER NOT NULL DEFAULT 20,
  "maxRedemptionPaisePerTxn" INTEGER NOT NULL DEFAULT 50000,
  "pointExpiryMonths" INTEGER NOT NULL DEFAULT 12,
  "earnToRedeemMinHours" INTEGER NOT NULL DEFAULT 24,
  "signupBonusPoints" INTEGER NOT NULL DEFAULT 0,
  "referralEarnerPoints" INTEGER NOT NULL DEFAULT 0,
  "referralReferredPoints" INTEGER NOT NULL DEFAULT 0,
  "birthdayBonusPoints" INTEGER NOT NULL DEFAULT 0,
  "highVelocityEarnDailyThreshold" INTEGER NOT NULL DEFAULT 5000,
  "bulkRedemptionPaiseThreshold" INTEGER NOT NULL DEFAULT 50000,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "cafeEarnEnabled" BOOLEAN NOT NULL DEFAULT true,
  "enabledSports" "Sport"[] DEFAULT ARRAY[]::"Sport"[],
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row with defaults.
INSERT INTO "RewardConfig" ("id", "updatedAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ─── 4. RewardBalance (one per user) ─────────────────────────────

CREATE TABLE "RewardBalance" (
  "userId" TEXT NOT NULL,
  "pointsAvailable" INTEGER NOT NULL DEFAULT 0,
  "pointsLifetimeEarned" INTEGER NOT NULL DEFAULT 0,
  "pointsLifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
  "pointsLifetimeExpired" INTEGER NOT NULL DEFAULT 0,
  "pointsLifetimeRevoked" INTEGER NOT NULL DEFAULT 0,
  "lastTransactionAt" TIMESTAMP(3),
  CONSTRAINT "RewardBalance_pkey" PRIMARY KEY ("userId")
);
CREATE INDEX "RewardBalance_pointsAvailable_idx" ON "RewardBalance"("pointsAvailable");
ALTER TABLE "RewardBalance"
  ADD CONSTRAINT "RewardBalance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 5. RewardTransaction (immutable ledger) ─────────────────────

CREATE TABLE "RewardTransaction" (
  "id" TEXT NOT NULL,
  "type" "RewardTxnType" NOT NULL,
  "points" INTEGER NOT NULL,
  "pointsValuePaise" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "bookingId" TEXT,
  "cafeOrderId" TEXT,
  "sourceTxnId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "reason" TEXT,
  "actorAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RewardTransaction_userId_createdAt_idx"  ON "RewardTransaction"("userId", "createdAt");
CREATE INDEX "RewardTransaction_userId_type_idx"       ON "RewardTransaction"("userId", "type");
CREATE INDEX "RewardTransaction_expiresAt_idx"         ON "RewardTransaction"("expiresAt");
CREATE INDEX "RewardTransaction_bookingId_idx"         ON "RewardTransaction"("bookingId");
CREATE INDEX "RewardTransaction_cafeOrderId_idx"       ON "RewardTransaction"("cafeOrderId");
CREATE UNIQUE INDEX "RewardTransaction_type_bookingId_key"   ON "RewardTransaction"("type", "bookingId");
CREATE UNIQUE INDEX "RewardTransaction_type_cafeOrderId_key" ON "RewardTransaction"("type", "cafeOrderId");
ALTER TABLE "RewardTransaction"
  ADD CONSTRAINT "RewardTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RewardTransaction"
  ADD CONSTRAINT "RewardTransaction_sourceTxnId_fkey"
  FOREIGN KEY ("sourceTxnId") REFERENCES "RewardTransaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 6. RewardAlert (fraud / misuse flags) ───────────────────────

CREATE TABLE "RewardAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "RewardAlertKind" NOT NULL,
  "severity" "RewardAlertSeverity" NOT NULL,
  "status" "RewardAlertStatus" NOT NULL DEFAULT 'OPEN',
  "details" JSONB NOT NULL,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RewardAlert_status_createdAt_idx" ON "RewardAlert"("status", "createdAt");
CREATE INDEX "RewardAlert_userId_status_idx"    ON "RewardAlert"("userId", "status");
CREATE INDEX "RewardAlert_kind_status_idx"      ON "RewardAlert"("kind", "status");
ALTER TABLE "RewardAlert"
  ADD CONSTRAINT "RewardAlert_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
