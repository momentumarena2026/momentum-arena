-- Adds EARNED_BOOKING_REMAINDER to the RewardTxnType enum so the
-- partial-payment remainder award (fired when admin marks the
-- venue-side cash collected) can carry its own ledger row without
-- colliding with the initial EARNED_BOOKING award on the
-- @@unique([type, bookingId]) constraint.
ALTER TYPE "RewardTxnType" ADD VALUE IF NOT EXISTS 'EARNED_BOOKING_REMAINDER' AFTER 'EARNED_BOOKING';
