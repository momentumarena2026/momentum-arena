-- ─────────────────────────────────────────────────────────────────────────────
-- SlotHold refactor: Booking is now only created on payment commitment.
-- Transient reservations live in the new SlotHold table.
--
-- PRODUCTION NOTE:
--   Any existing LOCKED bookings would break the enum-swap below. They are
--   all stale abandoned checkouts (the old auto-cancel cron expires them
--   after 5 minutes), so we cancel them here as a one-off data cleanup.
--   This is idempotent — no-op if no LOCKED rows exist.
--
--   Run `npx prisma migrate deploy` during a short maintenance window so
--   no new LOCKED rows are created between the UPDATE and the enum swap.
-- ─────────────────────────────────────────────────────────────────────────────

-- Data cleanup: cancel any lingering LOCKED bookings before the enum swap.
UPDATE "Booking" SET status = 'CANCELLED' WHERE status = 'LOCKED';

-- AlterEnum
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "BookingStatus_old";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropIndex
DROP INDEX "Booking_lockExpiresAt_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "lockExpiresAt",
DROP COLUMN "lockedAt",
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "SlotHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courtConfigId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" INTEGER[],
    "slotPrices" JSONB NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "razorpayOrderId" TEXT,
    "phonePeMerchantTxnId" TEXT,
    "paymentMethod" "PaymentMethod",
    "paymentAmount" INTEGER,
    "paymentInitiatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlotHold_razorpayOrderId_key" ON "SlotHold"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SlotHold_phonePeMerchantTxnId_key" ON "SlotHold"("phonePeMerchantTxnId");

-- CreateIndex
CREATE INDEX "SlotHold_date_expiresAt_idx" ON "SlotHold"("date", "expiresAt");

-- CreateIndex
CREATE INDEX "SlotHold_userId_idx" ON "SlotHold"("userId");

-- CreateIndex
CREATE INDEX "SlotHold_courtConfigId_date_idx" ON "SlotHold"("courtConfigId", "date");

-- CreateIndex
CREATE INDEX "SlotHold_expiresAt_idx" ON "SlotHold"("expiresAt");

-- AddForeignKey
ALTER TABLE "SlotHold" ADD CONSTRAINT "SlotHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotHold" ADD CONSTRAINT "SlotHold_courtConfigId_fkey" FOREIGN KEY ("courtConfigId") REFERENCES "CourtConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

