-- Add CAFE_INVENTORY_LIFETIME to ReportType — all-time variant of
-- the cafe inventory report (no date filter), matching the cafe
-- analytics page's default earliest→today window.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'CAFE_INVENTORY_LIFETIME';
