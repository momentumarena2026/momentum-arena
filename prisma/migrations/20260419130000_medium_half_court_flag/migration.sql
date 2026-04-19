-- Unified "Half Court (40x90)" customer flow: tag the booking lineage
-- (and the transient SlotHold that created it) so customer-facing views
-- render a neutral "Half Court" label instead of the concrete LEFT/RIGHT
-- courtConfig label. Admin views keep the concrete label. Defaults to
-- false for historical rows — no backfill.
ALTER TABLE "SlotHold"
  ADD COLUMN "wasBookedAsHalfCourt" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Booking"
  ADD COLUMN "wasBookedAsHalfCourt" BOOLEAN NOT NULL DEFAULT FALSE;
