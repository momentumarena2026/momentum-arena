-- CreateEnum
CREATE TYPE "OtaPlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "OtaReleaseKind" AS ENUM ('UPDATE', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "OtaReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "OtaRelease" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "runtimeVersion" TEXT NOT NULL,
    "platform" "OtaPlatform" NOT NULL,
    "kind" "OtaReleaseKind" NOT NULL DEFAULT 'UPDATE',
    "status" "OtaReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "launchAssetKey" TEXT NOT NULL,
    "launchAssetHash" TEXT NOT NULL,
    "launchAssetUrl" TEXT NOT NULL,
    "launchAssetContentType" TEXT NOT NULL DEFAULT 'application/javascript',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "commitTime" TIMESTAMP(3),
    "changelog" TEXT,
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "OtaRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtaReleaseAsset" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileExtension" TEXT NOT NULL,

    CONSTRAINT "OtaReleaseAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtaRelease_channel_runtimeVersion_platform_status_createdAt_idx" ON "OtaRelease"("channel", "runtimeVersion", "platform", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OtaReleaseAsset_releaseId_idx" ON "OtaReleaseAsset"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "OtaReleaseAsset_releaseId_key_key" ON "OtaReleaseAsset"("releaseId", "key");

-- AddForeignKey
ALTER TABLE "OtaReleaseAsset" ADD CONSTRAINT "OtaReleaseAsset_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "OtaRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

