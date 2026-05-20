-- Widen RewardConfig.maxRedemptionPctOfBill from Int to Float so admins
-- can configure fractional caps like 2.5% without us moving the whole
-- config to basis points. Postgres casts the existing integer values
-- (defaults to 20) cleanly. The redemption math
-- (Math.floor(billPaise * pct / 100)) is float-safe.
ALTER TABLE "RewardConfig"
  ALTER COLUMN "maxRedemptionPctOfBill" SET DATA TYPE DOUBLE PRECISION
  USING "maxRedemptionPctOfBill"::DOUBLE PRECISION;

ALTER TABLE "RewardConfig"
  ALTER COLUMN "maxRedemptionPctOfBill" SET DEFAULT 20;
