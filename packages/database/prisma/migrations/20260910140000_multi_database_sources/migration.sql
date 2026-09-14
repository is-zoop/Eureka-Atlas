CREATE TYPE "DataSourceType" AS ENUM ('MAXCOMPUTE', 'MYSQL', 'POSTGRESQL', 'SQLSERVER', 'ORACLE', 'MARIADB', 'SQLITE');
CREATE TYPE "StandardDataType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'JSON', 'BINARY', 'UNKNOWN');

ALTER TYPE "DataSourceStatus" ADD VALUE IF NOT EXISTS 'UNTESTED';

ALTER TABLE "data_source"
  ADD COLUMN "type" "DataSourceType" NOT NULL DEFAULT 'MAXCOMPUTE',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "connectionConfig" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "usernameEncrypted" TEXT,
  ADD COLUMN "passwordEncrypted" TEXT,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

UPDATE "data_source"
SET "connectionConfig" = jsonb_build_object(
  'region', "region",
  'endpoint', "endpoint",
  'catalog', "defaultProject"
)
WHERE "type" = 'MAXCOMPUTE';

ALTER TABLE "data_source"
  ALTER COLUMN "region" SET DEFAULT '',
  ALTER COLUMN "endpoint" SET DEFAULT '',
  ALTER COLUMN "defaultProject" SET DEFAULT '',
  ALTER COLUMN "accessKeyEncrypted" SET DEFAULT '',
  ALTER COLUMN "secretKeyEncrypted" SET DEFAULT '';

ALTER TABLE "meta_project"
  ADD COLUMN "catalog" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "schema" TEXT NOT NULL DEFAULT '';

UPDATE "meta_project"
SET "catalog" = "name"
WHERE "catalog" = '';

ALTER TABLE "meta_column"
  ADD COLUMN "normalizedType" "StandardDataType" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "isNullable" BOOLEAN,
  ADD COLUMN "defaultValue" TEXT,
  ADD COLUMN "isPrimaryKey" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "length" INTEGER,
  ADD COLUMN "precision" INTEGER,
  ADD COLUMN "scale" INTEGER;
