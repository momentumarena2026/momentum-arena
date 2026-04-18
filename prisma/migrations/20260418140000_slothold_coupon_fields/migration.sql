-- Persist the coupon applied during checkout on the SlotHold so that
-- createBookingFromHold can record the discount on Booking and create a
-- CouponUsage row when the booking lands.
ALTER TABLE "SlotHold"
  ADD COLUMN "couponId"       TEXT,
  ADD COLUMN "couponCode"     TEXT,
  ADD COLUMN "discountAmount" INTEGER;
