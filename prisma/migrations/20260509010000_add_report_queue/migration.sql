-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('SALES_MONTHLY', 'RAZORPAY_RECON_MONTHLY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "filename" TEXT,
    "fileSizeBytes" INTEGER,
    "fileBytes" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_requestedById_createdAt_idx" ON "Report"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "Report_type_year_month_idx" ON "Report"("type", "year", "month");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
