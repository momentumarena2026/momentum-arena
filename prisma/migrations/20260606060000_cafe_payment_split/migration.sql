-- Split-payment breakdown rows on a CafePayment. With no splits
-- the CafePayment alone represents the whole payment exactly as
-- before — backwards-compatible. Used when an order is settled
-- across more than one tender method (e.g. partial cash + UPI).
CREATE TABLE "CafePaymentSplit" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "utrNumber" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CafePaymentSplit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CafePaymentSplit_paymentId_idx" ON "CafePaymentSplit"("paymentId");

ALTER TABLE "CafePaymentSplit" ADD CONSTRAINT "CafePaymentSplit_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "CafePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
