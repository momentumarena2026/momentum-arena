-- CreateTable
CREATE TABLE "ServerActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "category" "AnalyticsCategory" NOT NULL,
    "outcome" TEXT NOT NULL,
    "path" TEXT,
    "method" TEXT,
    "platform" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerActionLog_userId_occurredAt_idx" ON "ServerActionLog"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ServerActionLog_action_occurredAt_idx" ON "ServerActionLog"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "ServerActionLog_occurredAt_idx" ON "ServerActionLog"("occurredAt");

-- CreateIndex
CREATE INDEX "ServerActionLog_category_occurredAt_idx" ON "ServerActionLog"("category", "occurredAt");

-- AddForeignKey
ALTER TABLE "ServerActionLog" ADD CONSTRAINT "ServerActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
