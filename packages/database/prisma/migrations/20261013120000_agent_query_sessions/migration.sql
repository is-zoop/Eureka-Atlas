CREATE TABLE "agent_query_session" (
  "id" TEXT NOT NULL,
  "ownerMemberNo" TEXT NOT NULL,
  "scopeMode" TEXT NOT NULL DEFAULT 'ALL',
  "selectedTableIds" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_query_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_query_session_ownerMemberNo_updatedAt_idx" ON "agent_query_session"("ownerMemberNo", "updatedAt");
CREATE INDEX "agent_query_session_expiresAt_idx" ON "agent_query_session"("expiresAt");
ALTER TABLE "query_execution" ADD COLUMN "agentQuerySessionId" TEXT, ADD COLUMN "agentScopeRevision" INTEGER;
CREATE INDEX "query_execution_agentQuerySessionId_submittedAt_idx" ON "query_execution"("agentQuerySessionId", "submittedAt");
ALTER TABLE "query_execution" ADD CONSTRAINT "query_execution_agentQuerySessionId_fkey" FOREIGN KEY ("agentQuerySessionId") REFERENCES "agent_query_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
