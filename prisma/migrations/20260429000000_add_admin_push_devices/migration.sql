-- CreateTable
CREATE TABLE "AdminPushDevice" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPushDevice_token_key" ON "AdminPushDevice"("token");

-- CreateIndex
CREATE INDEX "AdminPushDevice_adminId_idx" ON "AdminPushDevice"("adminId");

-- CreateIndex
CREATE INDEX "AdminPushDevice_lastSeenAt_idx" ON "AdminPushDevice"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "AdminPushDevice" ADD CONSTRAINT "AdminPushDevice_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
