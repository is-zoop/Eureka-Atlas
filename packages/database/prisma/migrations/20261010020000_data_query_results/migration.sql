CREATE TYPE "QueryExecutionKind" AS ENUM ('SEMANTIC_QUERY', 'DATA_QUERY');
ALTER TABLE "query_execution" ADD COLUMN "kind" "QueryExecutionKind" NOT NULL DEFAULT 'SEMANTIC_QUERY',
 ADD COLUMN "resultRowCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "resolvedDates" JSONB NOT NULL DEFAULT '[]';
CREATE INDEX "query_execution_kind_status_idx" ON "query_execution"("kind","status");
CREATE TABLE "query_result_chunk" ("queryExecutionId" TEXT NOT NULL, "chunkIndex" INTEGER NOT NULL, "rows" JSONB NOT NULL,
 CONSTRAINT "query_result_chunk_pkey" PRIMARY KEY ("queryExecutionId", "chunkIndex"),
 CONSTRAINT "query_result_chunk_execution_fkey" FOREIGN KEY ("queryExecutionId") REFERENCES "query_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE);
