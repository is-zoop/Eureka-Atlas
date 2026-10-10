-- Old records intentionally remain unowned and inaccessible.
ALTER TABLE "ask_session" ADD COLUMN "ownerMemberNo" TEXT;
ALTER TABLE "query_execution" ADD COLUMN "ownerMemberNo" TEXT;
DROP INDEX "ask_run_idempotencyKey_key";
DROP INDEX "ask_session_updatedAt_idx";
DROP INDEX "query_execution_idempotencyKey_idx";
CREATE UNIQUE INDEX "ask_run_askSessionId_idempotencyKey_key" ON "ask_run"("askSessionId", "idempotencyKey");
CREATE UNIQUE INDEX "query_execution_ownerMemberNo_idempotencyKey_key" ON "query_execution"("ownerMemberNo", "idempotencyKey");
CREATE INDEX "ask_session_ownerMemberNo_updatedAt_id_idx" ON "ask_session"("ownerMemberNo", "updatedAt", "id");
CREATE INDEX "query_execution_ownerMemberNo_submittedAt_idx" ON "query_execution"("ownerMemberNo", "submittedAt");
