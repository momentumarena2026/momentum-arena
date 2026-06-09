-- Add CAFE_INVENTORY_MONTHLY to ReportType enum. Downloadable
-- copy of the cafe-analytics inventory table — one row per
-- CafeItem with monthly units sold, cash / online split, and
-- current on-hand stock.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'CAFE_INVENTORY_MONTHLY';
