-- AlterTable
ALTER TABLE "cli_tokens" ADD COLUMN     "deviceId" TEXT;

-- AlterTable
ALTER TABLE "daily_project_stats" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_snapshots" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bundleStorageKey" TEXT,
    "manifest" JSONB NOT NULL,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sync_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "targetDeviceId" TEXT NOT NULL,
    "targetProjectId" TEXT,
    "itemIds" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_name_key" ON "devices"("userId", "name");

-- CreateIndex
CREATE INDEX "sync_snapshots_orgId_createdAt_idx" ON "sync_snapshots"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_snapshots_deviceId_createdAt_idx" ON "sync_snapshots"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_jobs_orgId_createdAt_idx" ON "sync_jobs"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_jobs_targetDeviceId_status_createdAt_idx" ON "sync_jobs"("targetDeviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "cli_tokens_deviceId_idx" ON "cli_tokens"("deviceId");

-- AddForeignKey
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_snapshots" ADD CONSTRAINT "sync_snapshots_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_snapshots" ADD CONSTRAINT "sync_snapshots_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "sync_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_targetDeviceId_fkey" FOREIGN KEY ("targetDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
