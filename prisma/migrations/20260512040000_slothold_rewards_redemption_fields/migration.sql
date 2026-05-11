-- Carrier columns for the in-checkout Momentum Points redemption
-- flow. Populated by applyPointsRedemptionToHold() after the slider
-- preview validates the pick, then consumed atomically by
-- createBookingFromHold().

ALTER TABLE "SlotHold"
  ADD COLUMN IF NOT EXISTS "pointsToRedeem" INTEGER,
  ADD COLUMN IF NOT EXISTS "pointsRedeemPaiseSaved" INTEGER;
