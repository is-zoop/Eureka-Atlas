-- Display conversion is determined solely by the existing unit.
-- Keep the already-applied add-column migration unchanged; remove its obsolete configuration.
ALTER TABLE "column_semantic" DROP COLUMN "displayFormat";
ALTER TABLE "semantic_metric" DROP COLUMN "displayFormat";
