-- Product cost-price (cost-of-goods) tracking
--
-- Adds optional cost columns so the admin analytics tab can compute
-- gross profit per product (revenue − cost × qty sold). Both columns
-- default to 0 so existing rows / historical orders don't need a
-- backfill; admins set Product.costPaise from the product edit form
-- and from then on new orders will snapshot the cost onto each item.
--
-- Idempotent — `IF NOT EXISTS` so a partial deploy retry won't error.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "costPaise" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProductOrderItem"
  ADD COLUMN IF NOT EXISTS "costEachPaise" INTEGER NOT NULL DEFAULT 0;
