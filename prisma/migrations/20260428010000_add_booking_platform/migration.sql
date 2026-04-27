-- AlterTable
-- Adds Booking.platform with a column-level default of 'web'. Postgres
-- backfills existing rows with the default in the same statement, so we
-- don't need a separate UPDATE. New code paths overwrite the default for
-- mobile bookings via createBookingFromHold(..., platform).
ALTER TABLE "Booking" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'web';
