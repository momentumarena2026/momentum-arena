-- AlterEnum
-- IF NOT EXISTS so re-running against a DB that's already had the value
-- added (e.g. via prisma db push during a worktree session) is a no-op
-- instead of an error.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'EXPENSES_MONTHLY';
