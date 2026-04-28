-- AlterTable
-- Adds the timestamp the cron sets when it sends the 1-hour push
-- reminder. Nullable so existing rows aren't backfilled (we don't
-- want to retroactively mark reminders as sent for completed bookings).
ALTER TABLE "Booking" ADD COLUMN "reminder1SentAt" TIMESTAMP(3);
