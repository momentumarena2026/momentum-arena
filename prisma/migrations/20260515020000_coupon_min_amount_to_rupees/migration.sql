-- Phase 9: Unify Coupon.minAmount to whole rupees.
--
-- Why: the admin form's placeholder said "50000 = ₹500" so admins
-- typed paise into the column, but validateCoupon compared the
-- stored value against hold.totalAmount (already rupees) — so a
-- coupon "minimum ₹500" actually required a ₹50,000 booking before
-- firing. The customer/admin chips meanwhile rendered the same
-- stored value via formatPrice() which treats input as rupees,
-- showing "₹50,000" — visually matching the broken comparison, not
-- the admin's intent.
--
-- After this migration:
--   - schema comment reads "in WHOLE RUPEES"
--   - admin form takes rupees (placeholder "500 for ₹500")
--   - validateCoupon compares rupees against rupees (no /100)
--   - chips/customer cards stay on formatPrice() — values now mean
--     the right thing
--
-- Existing rows assumed to be in paise (per the old placeholder)
-- and divided by 100. Anything already in rupees (rare; would
-- require an admin who saw through the placeholder) becomes too
-- small — admin can re-set via /admin/coupons. The alternative
-- (leaving rows alone) would silently break every coupon that
-- ever set a minimum, since the new comparison would treat the
-- paise value as rupees and refuse to fire until the booking
-- total exceeded ₹50,000 again.
UPDATE "Coupon"
   SET "minAmount" = "minAmount" / 100
 WHERE "minAmount" IS NOT NULL
   AND "minAmount" > 0;
