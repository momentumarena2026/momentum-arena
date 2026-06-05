-- Two unrelated cafe additions in one migration so they ship as a
-- single feature batch.
--
-- 1. CafeItem.quantity (nullable). Stock count per item.
--      NULL → unlimited / kitchen-prepared item (cooked to order).
--      0    → out of stock; order paths refuse it.
--      n>0  → N units on hand; order paths decrement.
--
-- 2. CafeSettings.isOpen (default true). Master open / closed
--    switch driving the customer-facing /cafe + the mobile Cafe
--    tab. Default true so the existing single CafeSettings row
--    keeps behaving as "open" without an explicit backfill.

ALTER TABLE "CafeItem"      ADD COLUMN "quantity" INTEGER;
ALTER TABLE "CafeSettings"  ADD COLUMN "isOpen"   BOOLEAN NOT NULL DEFAULT true;
