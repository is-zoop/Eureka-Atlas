ALTER TABLE "ai_table_suggestion" ADD COLUMN "queryConfig" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "table_semantic" ADD COLUMN "queryConfig" JSONB NOT NULL DEFAULT '{}';
