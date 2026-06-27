-- CreateTable
CREATE TABLE "PushDispatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "audience" TEXT,
    "sentByAdminId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cleanedUp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushDispatch_createdAt_idx" ON "PushDispatch"("createdAt");

-- CreateIndex
CREATE INDEX "PushDispatch_kind_createdAt_idx" ON "PushDispatch"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "PushDispatch_source_createdAt_idx" ON "PushDispatch"("source", "createdAt");
