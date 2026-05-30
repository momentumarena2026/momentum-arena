-- Adds COMPLETED + ABSENT to BookingStatus so admins can close out
-- past slots without leaving them stuck on CONFIRMED. The companion
-- server actions (markBookingCompleted / markBookingAbsent) flip
-- Payment.status to COMPLETED with the advance retained as earnings;
-- the remainder is forfeit (not chased, not refunded).
--
-- Backfill: nothing to do — all live bookings stay on their current
-- status. Existing reports that filter by ["CONFIRMED", "CANCELLED"]
-- continue to work; new dashboards can read COMPLETED/ABSENT
-- separately.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'COMPLETED' AFTER 'CANCELLED';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'ABSENT' AFTER 'COMPLETED';
