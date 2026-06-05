-- Mid-checkout intent for online cafe orders. Holds the cart while
-- the customer is in the Razorpay / PhonePe modal; only materialises
-- into a CafeOrder + CafeOrderItem + CafePayment on verified payment.
-- Modal dismiss / payment failure deletes the intent — the CafeOrder
-- table never sees a phantom CANCELLED row again.
CREATE TABLE "CafePaymentIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "note" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "cart" JSONB NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "originalAmount" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountCodeId" TEXT,
    "razorpayOrderId" TEXT,
    "phonePeMerchantTxnId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafePaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CafePaymentIntent_razorpayOrderId_key" ON "CafePaymentIntent"("razorpayOrderId");
CREATE UNIQUE INDEX "CafePaymentIntent_phonePeMerchantTxnId_key" ON "CafePaymentIntent"("phonePeMerchantTxnId");
CREATE UNIQUE INDEX "CafePaymentIntent_consumedOrderId_key" ON "CafePaymentIntent"("consumedOrderId");
CREATE INDEX "CafePaymentIntent_userId_idx" ON "CafePaymentIntent"("userId");
CREATE INDEX "CafePaymentIntent_expiresAt_idx" ON "CafePaymentIntent"("expiresAt");
