CREATE TYPE "ColumnSemanticType_new" AS ENUM ('METRIC', 'DIMENSION', 'LABEL', 'PARTITION');

ALTER TABLE "column_semantic"
  ALTER COLUMN "semanticType" TYPE "ColumnSemanticType_new"
  USING (CASE WHEN "semanticType"::text = 'ATTRIBUTE' THEN 'LABEL' ELSE "semanticType"::text END)::"ColumnSemanticType_new";

DROP TYPE "ColumnSemanticType";
ALTER TYPE "ColumnSemanticType_new" RENAME TO "ColumnSemanticType";
