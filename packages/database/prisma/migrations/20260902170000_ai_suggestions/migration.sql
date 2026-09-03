CREATE TABLE "ai_table_suggestion" (
  "id" TEXT NOT NULL, "governanceTaskId" TEXT NOT NULL, "businessName" TEXT NOT NULL, "description" TEXT NOT NULL, "grain" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_table_suggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_table_suggestion_governanceTaskId_key" ON "ai_table_suggestion"("governanceTaskId");
ALTER TABLE "ai_table_suggestion" ADD CONSTRAINT "ai_table_suggestion_governanceTaskId_fkey" FOREIGN KEY ("governanceTaskId") REFERENCES "governance_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "ai_column_suggestion" (
  "id" TEXT NOT NULL, "governanceTaskId" TEXT NOT NULL, "metaColumnId" TEXT NOT NULL, "businessName" TEXT NOT NULL, "semanticType" TEXT NOT NULL, "description" TEXT NOT NULL, "aggregation" TEXT, "unit" TEXT, "usageRule" TEXT, "confidence" DOUBLE PRECISION NOT NULL, "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_column_suggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_column_suggestion_governanceTaskId_metaColumnId_key" ON "ai_column_suggestion"("governanceTaskId", "metaColumnId");
CREATE INDEX "ai_column_suggestion_metaColumnId_idx" ON "ai_column_suggestion"("metaColumnId");
ALTER TABLE "ai_column_suggestion" ADD CONSTRAINT "ai_column_suggestion_governanceTaskId_fkey" FOREIGN KEY ("governanceTaskId") REFERENCES "governance_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_column_suggestion" ADD CONSTRAINT "ai_column_suggestion_metaColumnId_fkey" FOREIGN KEY ("metaColumnId") REFERENCES "meta_column"("id") ON DELETE CASCADE ON UPDATE CASCADE;
