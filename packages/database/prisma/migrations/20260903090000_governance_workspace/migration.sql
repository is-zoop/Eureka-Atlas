ALTER TABLE "ai_column_suggestion" RENAME COLUMN "businessName" TO "metricName";
ALTER TABLE "column_semantic" RENAME COLUMN "businessName" TO "metricName";

ALTER TABLE "table_semantic" ADD COLUMN "permissionColumnId" TEXT;
CREATE INDEX "table_semantic_permissionColumnId_idx" ON "table_semantic"("permissionColumnId");
ALTER TABLE "table_semantic" ADD CONSTRAINT "table_semantic_permissionColumnId_fkey" FOREIGN KEY ("permissionColumnId") REFERENCES "meta_column"("id") ON DELETE SET NULL ON UPDATE CASCADE;
