-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'DEPRECATED');

-- CreateTable
CREATE TABLE "data_source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "defaultProject" TEXT NOT NULL,
    "accessKeyEncrypted" TEXT NOT NULL,
    "secretKeyEncrypted" TEXT NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_project" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_table" (
    "id" TEXT NOT NULL,
    "metaProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_column" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "comment" TEXT,
    "ordinal" INTEGER NOT NULL,
    "isPartition" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_column_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_source_name_key" ON "data_source"("name");

-- CreateIndex
CREATE UNIQUE INDEX "meta_project_dataSourceId_name_key" ON "meta_project"("dataSourceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "meta_table_metaProjectId_name_key" ON "meta_table"("metaProjectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "meta_column_metaTableId_name_key" ON "meta_column"("metaTableId", "name");

-- AddForeignKey
ALTER TABLE "meta_project" ADD CONSTRAINT "meta_project_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_table" ADD CONSTRAINT "meta_table_metaProjectId_fkey" FOREIGN KEY ("metaProjectId") REFERENCES "meta_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_column" ADD CONSTRAINT "meta_column_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
