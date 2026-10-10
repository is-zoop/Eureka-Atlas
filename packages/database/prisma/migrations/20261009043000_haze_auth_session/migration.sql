CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "memberNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_session_expiresAt_idx" ON "auth_session"("expiresAt");
