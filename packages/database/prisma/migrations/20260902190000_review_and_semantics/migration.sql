CREATE TYPE "ColumnSemanticType" AS ENUM ('METRIC', 'DIMENSION', 'ATTRIBUTE');

ALTER TABLE "ai_table_suggestion" ADD COLUMN "usageScenario" TEXT;

CREATE TABLE "governance_review" (
    "id" TEXT NOT NULL,
    "governanceTaskId" TEXT NOT NULL,
    "tableDraft" JSONB NOT NULL,
    "columnDrafts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "governance_review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "table_semantic" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "sourceGovernanceTaskId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "grain" TEXT NOT NULL,
    "usageScenario" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "table_semantic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "column_semantic" (
    "id" TEXT NOT NULL,
    "metaColumnId" TEXT NOT NULL,
    "sourceGovernanceTaskId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "semanticType" "ColumnSemanticType" NOT NULL,
    "aggregation" TEXT,
    "unit" TEXT,
    "usageRule" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "column_semantic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "governance_review_governanceTaskId_key" ON "governance_review"("governanceTaskId");
CREATE UNIQUE INDEX "table_semantic_metaTableId_key" ON "table_semantic"("metaTableId");
CREATE INDEX "table_semantic_sourceGovernanceTaskId_idx" ON "table_semantic"("sourceGovernanceTaskId");
CREATE UNIQUE INDEX "column_semantic_metaColumnId_key" ON "column_semantic"("metaColumnId");
CREATE INDEX "column_semantic_sourceGovernanceTaskId_idx" ON "column_semantic"("sourceGovernanceTaskId");

ALTER TABLE "governance_review" ADD CONSTRAINT "governance_review_governanceTaskId_fkey" FOREIGN KEY ("governanceTaskId") REFERENCES "governance_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_semantic" ADD CONSTRAINT "table_semantic_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_semantic" ADD CONSTRAINT "table_semantic_sourceGovernanceTaskId_fkey" FOREIGN KEY ("sourceGovernanceTaskId") REFERENCES "governance_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "column_semantic" ADD CONSTRAINT "column_semantic_metaColumnId_fkey" FOREIGN KEY ("metaColumnId") REFERENCES "meta_column"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "column_semantic" ADD CONSTRAINT "column_semantic_sourceGovernanceTaskId_fkey" FOREIGN KEY ("sourceGovernanceTaskId") REFERENCES "governance_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
