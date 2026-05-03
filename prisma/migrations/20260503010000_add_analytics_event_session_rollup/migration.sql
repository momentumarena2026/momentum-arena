-- CreateEnum
CREATE TYPE "AnalyticsCategory" AS ENUM ('BOOKING', 'PAYMENT', 'AUTH', 'CAFE', 'WAITLIST', 'NAVIGATION', 'ADMIN', 'ERROR', 'SYSTEM');

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "platform" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "landingPath" TEXT,
    "referrer" TEXT,
    "uaBrowser" TEXT,
    "uaOs" TEXT,
    "uaDevice" TEXT,
    "appVersion" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsSession_userId_idx" ON "AnalyticsSession"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_idx" ON "AnalyticsSession"("startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_userId_startedAt_idx" ON "AnalyticsSession"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AnalyticsCategory" NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "pageUrl" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_occurredAt_idx" ON "AnalyticsEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex (BRIN-friendly time-only — used by retention cron + rollup writer)
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_category_occurredAt_idx" ON "AnalyticsEvent"("category", "occurredAt");

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MetricRollup" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketKind" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "sumValue" DOUBLE PRECISION,
    "uniqueCount" INTEGER,
    "dimensionsKey" TEXT NOT NULL,

    CONSTRAINT "MetricRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricRollup_bucketStart_bucketKind_metric_dimensionsKey_key" ON "MetricRollup"("bucketStart", "bucketKind", "metric", "dimensionsKey");

-- CreateIndex
CREATE INDEX "MetricRollup_metric_bucketStart_idx" ON "MetricRollup"("metric", "bucketStart");

-- CreateIndex
CREATE INDEX "MetricRollup_bucketStart_idx" ON "MetricRollup"("bucketStart");

-- CreateTable
CREATE TABLE "UserCohort" (
    "userId" TEXT NOT NULL,
    "cohortWeek" TIMESTAMP(3) NOT NULL,
    "cohortMonth" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCohort_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "UserCohort_cohortWeek_idx" ON "UserCohort"("cohortWeek");

-- CreateIndex
CREATE INDEX "UserCohort_cohortMonth_idx" ON "UserCohort"("cohortMonth");

-- AddForeignKey
ALTER TABLE "UserCohort" ADD CONSTRAINT "UserCohort_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
