CREATE TYPE "DataSourceSyncStatus" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'PARTIAL_FAILED', 'FAILED');

ALTER TABLE "data_source"
  ADD COLUMN "syncStatus" "DataSourceSyncStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "syncTotalTables" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncProcessedTables" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncSyncedTables" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncSkippedTables" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncFailedTables" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncError" TEXT,
  ADD COLUMN "syncStartedAt" TIMESTAMP(3),
  ADD COLUMN "syncFinishedAt" TIMESTAMP(3);

UPDATE "data_source"
SET "syncStatus" = 'FAILED',
    "syncError" = '同步在服务重启前未完成，请重新同步。',
    "syncFinishedAt" = NOW()
WHERE "syncStatus" = 'RUNNING';
