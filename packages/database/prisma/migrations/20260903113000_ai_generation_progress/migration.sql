-- CreateEnum
CREATE TYPE "AiGenerationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiGenerationStep" AS ENUM ('SAVING_DRAFT', 'PREPARING_CONTEXT', 'CALLING_LLM', 'VALIDATING_RESULT', 'SAVING_SUGGESTIONS');

-- CreateTable
CREATE TABLE "ai_generation" (
    "id" TEXT NOT NULL,
    "governanceTaskId" TEXT NOT NULL,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'RUNNING',
    "step" "AiGenerationStep" NOT NULL DEFAULT 'SAVING_DRAFT',
    "message" TEXT NOT NULL,
    "error" TEXT,
    "previousTaskStatus" "GovernanceTaskStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ai_generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_generation_governanceTaskId_status_idx" ON "ai_generation"("governanceTaskId", "status");

-- CreateIndex
CREATE INDEX "ai_generation_startedAt_idx" ON "ai_generation"("startedAt");

-- AddForeignKey
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_governanceTaskId_fkey" FOREIGN KEY ("governanceTaskId") REFERENCES "governance_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
