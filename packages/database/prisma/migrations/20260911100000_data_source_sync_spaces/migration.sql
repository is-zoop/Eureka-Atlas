CREATE TABLE "data_source_sync_space" (
  "id" TEXT NOT NULL,
  "dataSourceId" TEXT NOT NULL,
  "catalog" TEXT NOT NULL DEFAULT '',
  "schema" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "syncStatus" "DataSourceSyncStatus" NOT NULL DEFAULT 'IDLE',
  "syncTotalTables" INTEGER NOT NULL DEFAULT 0,
  "syncProcessedTables" INTEGER NOT NULL DEFAULT 0,
  "syncSyncedTables" INTEGER NOT NULL DEFAULT 0,
  "syncSkippedTables" INTEGER NOT NULL DEFAULT 0,
  "syncFailedTables" INTEGER NOT NULL DEFAULT 0,
  "syncError" TEXT,
  "syncStartedAt" TIMESTAMP(3),
  "syncFinishedAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_source_sync_space_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_source_sync_space_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_source"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "data_source_sync_space_dataSourceId_catalog_schema_key" ON "data_source_sync_space"("dataSourceId", "catalog", "schema");
CREATE INDEX "data_source_sync_space_dataSourceId_selected_idx" ON "data_source_sync_space"("dataSourceId", "selected");

INSERT INTO "data_source_sync_space" (
  "id", "dataSourceId", "catalog", "schema", "name", "description", "selected", "lastSyncedAt", "createdAt", "updatedAt"
)
SELECT
  'migrated_' || md5("dataSourceId" || ':' || "catalog" || ':' || "schema"),
  "dataSourceId", "catalog", "schema", "name", "description", true, "lastSyncedAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "meta_project"
ON CONFLICT ("dataSourceId", "catalog", "schema") DO NOTHING;
