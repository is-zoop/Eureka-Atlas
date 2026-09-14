CREATE TABLE "ai_metric_suggestion" (
    "id" TEXT NOT NULL,
    "governanceTaskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "unit" TEXT,
    "dependencies" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_metric_suggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_metric_suggestion_governanceTaskId_name_key" ON "ai_metric_suggestion"("governanceTaskId", "name");
CREATE INDEX "ai_metric_suggestion_governanceTaskId_idx" ON "ai_metric_suggestion"("governanceTaskId");

ALTER TABLE "ai_metric_suggestion" ADD CONSTRAINT "ai_metric_suggestion_governanceTaskId_fkey"
  FOREIGN KEY ("governanceTaskId") REFERENCES "governance_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
