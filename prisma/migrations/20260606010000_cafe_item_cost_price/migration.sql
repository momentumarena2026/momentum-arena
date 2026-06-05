-- Per-item cost price for cafe menu items so the venue can track
-- margin alongside the selling price already stored in
-- CafeItem.price. Nullable + no default — existing rows stay
-- "unknown margin" until an admin edits them; reporting paths
-- treat NULL as "skip from profit calc" rather than zero.
ALTER TABLE "CafeItem" ADD COLUMN "costPrice" INTEGER;
