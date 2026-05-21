-- Two new ReportType enum values for the per-transaction reward
-- ledger reports. Safe to ship on a live DB: ALTER TYPE ADD VALUE
-- is non-blocking in Postgres ≥ 12 and skips if the value exists.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'REWARD_TXN_LEDGER_MONTHLY' AFTER 'REWARD_ALERTS_MONTHLY';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'REWARD_TXN_LEDGER_LIFETIME' AFTER 'REWARD_TXN_LEDGER_MONTHLY';
