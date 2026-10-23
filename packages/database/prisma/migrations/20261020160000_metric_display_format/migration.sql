-- Display metadata only. Do not guess scales or rewrite formulas / saved results.
ALTER TABLE "column_semantic" ADD COLUMN "displayFormat" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "semantic_metric" ADD COLUMN "displayFormat" JSONB NOT NULL DEFAULT '{}';
