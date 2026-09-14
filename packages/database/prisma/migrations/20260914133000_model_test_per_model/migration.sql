ALTER TABLE "model_config"
  ADD COLUMN "lastTestStatus" "ModelTestStatus" NOT NULL DEFAULT 'UNTESTED',
  ADD COLUMN "lastTestedAt" TIMESTAMP(3),
  ADD COLUMN "lastTestLatencyMs" INTEGER,
  ADD COLUMN "lastTestError" TEXT;

ALTER TABLE "model_provider"
  DROP COLUMN "lastTestStatus",
  DROP COLUMN "lastTestedAt",
  DROP COLUMN "lastTestLatencyMs",
  DROP COLUMN "lastTestError";
