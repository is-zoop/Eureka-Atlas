CREATE TYPE "GovernanceTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEWING', 'COMPLETED');

CREATE TABLE "governance_task" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "selectedColumns" JSONB NOT NULL,
    "status" "GovernanceTaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "governance_task_metaTableId_idx" ON "governance_task"("metaTableId");
CREATE INDEX "governance_task_createdAt_idx" ON "governance_task"("createdAt");

ALTER TABLE "governance_task" ADD CONSTRAINT "governance_task_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
