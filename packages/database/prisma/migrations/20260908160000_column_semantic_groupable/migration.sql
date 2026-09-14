ALTER TABLE "column_semantic"
  ADD COLUMN "groupable" BOOLEAN NOT NULL DEFAULT false;

UPDATE "column_semantic"
SET "aggregation" = NULL,
    "unit" = NULL,
    "groupable" = false
WHERE "semanticType" IN ('DIMENSION', 'LABEL', 'PARTITION');
