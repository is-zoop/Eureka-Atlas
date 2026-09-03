-- AlterTable
ALTER TABLE "governance_review" ADD COLUMN     "metricDrafts" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "semantic_metric" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "sourceGovernanceTaskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "unit" TEXT,
    "description" TEXT,
    "dependencies" JSONB NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "semantic_metric_sourceGovernanceTaskId_idx" ON "semantic_metric"("sourceGovernanceTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_metric_metaTableId_name_key" ON "semantic_metric"("metaTableId", "name");

-- AddForeignKey
ALTER TABLE "semantic_metric" ADD CONSTRAINT "semantic_metric_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_metric" ADD CONSTRAINT "semantic_metric_sourceGovernanceTaskId_fkey" FOREIGN KEY ("sourceGovernanceTaskId") REFERENCES "governance_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
