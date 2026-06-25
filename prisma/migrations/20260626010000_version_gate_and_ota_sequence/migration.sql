-- AlterTable
ALTER TABLE "OtaRelease" ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AppVersionGate" (
    "id" TEXT NOT NULL,
    "platform" "OtaPlatform" NOT NULL,
    "channel" TEXT NOT NULL,
    "latestBuild" INTEGER NOT NULL,
    "latestVersionName" TEXT,
    "minSupportedBuild" INTEGER NOT NULL DEFAULT 0,
    "storeUrl" TEXT NOT NULL,
    "message" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppVersionGate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppVersionGate_platform_channel_key" ON "AppVersionGate"("platform", "channel");

