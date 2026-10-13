-- Foundation missing from the original migration history. Ownership and large
-- data-query results are deliberately added by the later existing migrations.
CREATE TYPE "QueryExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLING', 'CANCELLED', 'TIMED_OUT');
CREATE TYPE "AskRunStatus" AS ENUM ('RUNNING', 'WAITING_CLARIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLING', 'CANCELLED', 'INTERRUPTED');
CREATE TYPE "AskMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

CREATE TABLE "query_execution" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "status" "QueryExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "remoteInstanceId" TEXT,
    "idempotencyKey" TEXT,
    "request" JSONB NOT NULL,
    "sql" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "snapshotDate" TEXT,
    "resultColumns" JSONB,
    "result" JSONB,
    "resultBytes" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "query_execution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_session" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tableIds" JSONB NOT NULL DEFAULT '[]',
    "modelConfigId" TEXT NOT NULL,
    "thinkingLevel" TEXT NOT NULL DEFAULT 'off',
    "configurationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ask_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_run" (
    "id" TEXT NOT NULL,
    "askSessionId" TEXT,
    "status" "AskRunStatus" NOT NULL DEFAULT 'RUNNING',
    "idempotencyKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "modelConfigId" TEXT NOT NULL,
    "modelDisplayName" TEXT,
    "modelProviderName" TEXT,
    "thinkingLevel" TEXT NOT NULL DEFAULT 'off',
    "tableIds" JSONB NOT NULL,
    "packageVersions" JSONB NOT NULL DEFAULT '{}',
    "clarification" JSONB,
    "error" TEXT,
    "clarificationId" TEXT,
    "nextEventSequence" INTEGER NOT NULL DEFAULT 0,
    "nextMessageSequence" INTEGER NOT NULL DEFAULT 0,
    "queryDefinition" JSONB,
    "conditionChanges" JSONB,
    "loopVersion" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ask_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_run_message" (
    "id" TEXT NOT NULL,
    "askRunId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" "AskMessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ask_run_message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_run_event" (
    "id" TEXT NOT NULL,
    "askRunId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ask_run_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_run_query" (
    "id" TEXT NOT NULL,
    "askRunId" TEXT NOT NULL,
    "queryExecutionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ask_run_query_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ask_saved_query_result" (
    "id" TEXT NOT NULL,
    "askSessionId" TEXT NOT NULL,
    "askRunId" TEXT NOT NULL,
    "queryExecutionId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ask_saved_query_result_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "query_execution_remoteInstanceId_key" ON "query_execution"("remoteInstanceId");
CREATE INDEX "query_execution_status_idx" ON "query_execution"("status");
CREATE INDEX "query_execution_idempotencyKey_idx" ON "query_execution"("idempotencyKey");
CREATE INDEX "query_execution_metaTableId_submittedAt_idx" ON "query_execution"("metaTableId", "submittedAt");
CREATE INDEX "ask_session_updatedAt_idx" ON "ask_session"("updatedAt");
CREATE UNIQUE INDEX "ask_run_idempotencyKey_key" ON "ask_run"("idempotencyKey");
CREATE INDEX "ask_run_status_idx" ON "ask_run"("status");
CREATE INDEX "ask_run_askSessionId_startedAt_idx" ON "ask_run"("askSessionId", "startedAt");
CREATE UNIQUE INDEX "ask_run_message_askRunId_sequence_key" ON "ask_run_message"("askRunId", "sequence");
CREATE UNIQUE INDEX "ask_run_event_askRunId_sequence_key" ON "ask_run_event"("askRunId", "sequence");
CREATE INDEX "ask_run_event_askRunId_sequence_idx" ON "ask_run_event"("askRunId", "sequence");
CREATE UNIQUE INDEX "ask_run_query_queryExecutionId_key" ON "ask_run_query"("queryExecutionId");
CREATE INDEX "ask_run_query_askRunId_idx" ON "ask_run_query"("askRunId");
CREATE UNIQUE INDEX "ask_saved_query_result_queryExecutionId_key" ON "ask_saved_query_result"("queryExecutionId");
CREATE INDEX "ask_saved_query_result_askRunId_idx" ON "ask_saved_query_result"("askRunId");

ALTER TABLE "query_execution" ADD CONSTRAINT "query_execution_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ask_run" ADD CONSTRAINT "ask_run_askSessionId_fkey" FOREIGN KEY ("askSessionId") REFERENCES "ask_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ask_run_message" ADD CONSTRAINT "ask_run_message_askRunId_fkey" FOREIGN KEY ("askRunId") REFERENCES "ask_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ask_run_event" ADD CONSTRAINT "ask_run_event_askRunId_fkey" FOREIGN KEY ("askRunId") REFERENCES "ask_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ask_run_query" ADD CONSTRAINT "ask_run_query_askRunId_fkey" FOREIGN KEY ("askRunId") REFERENCES "ask_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ask_run_query" ADD CONSTRAINT "ask_run_query_queryExecutionId_fkey" FOREIGN KEY ("queryExecutionId") REFERENCES "query_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ask_saved_query_result" ADD CONSTRAINT "ask_saved_query_result_askSessionId_fkey" FOREIGN KEY ("askSessionId") REFERENCES "ask_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
