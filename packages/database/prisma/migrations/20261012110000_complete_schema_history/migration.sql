-- Align changes that existed in the application schema but were missing from
-- the migration history. Preserve all existing rows and credential values.
ALTER TABLE "data_source" ALTER COLUMN "status" SET DEFAULT 'UNTESTED';

ALTER TABLE "model_provider"
    ADD COLUMN "authMode" TEXT NOT NULL DEFAULT 'API_KEY',
    ADD COLUMN "oauthEncrypted" TEXT;
DROP INDEX "model_provider_builtinId_key";
CREATE UNIQUE INDEX "model_provider_builtinId_authMode_key" ON "model_provider"("builtinId", "authMode");

ALTER TABLE "query_result_chunk" RENAME CONSTRAINT "query_result_chunk_execution_fkey" TO "query_result_chunk_queryExecutionId_fkey";
