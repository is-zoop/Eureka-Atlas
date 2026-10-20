-- Conversation scope follows its conversation, not a seven-day login timeout.
-- Preserve all existing scope IDs, revisions, selected tables and query ownership.
DROP INDEX IF EXISTS "agent_query_session_expiresAt_idx";
ALTER TABLE "agent_query_session" DROP COLUMN "expiresAt", ADD COLUMN "clientConversationId" TEXT;
CREATE UNIQUE INDEX "agent_query_session_ownerMemberNo_clientConversationId_key" ON "agent_query_session"("ownerMemberNo", "clientConversationId");
CREATE TABLE "agent_selection_access" (
  "id" TEXT NOT NULL,
  "agentQuerySessionId" TEXT NOT NULL,
  "credentialEncrypted" TEXT,
  "credentialDigest" TEXT,
  "grantHash" TEXT,
  "grantExpiresAt" TIMESTAMP(3),
  "epoch" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_selection_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_selection_access_agentQuerySessionId_fkey" FOREIGN KEY ("agentQuerySessionId") REFERENCES "agent_query_session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_selection_access_agentQuerySessionId_key" ON "agent_selection_access"("agentQuerySessionId");
