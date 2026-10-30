ALTER TABLE "SenderLimitEvent"
  ADD COLUMN "notificationState" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseToken" UUID,
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "connectionGeneration" UUID,
  ADD COLUMN "lastNotificationError" TEXT;
CREATE INDEX "SenderLimitEvent_namespace_notificationState_nextAttemptAt_idx"
  ON "SenderLimitEvent" ("namespace", "notificationState", "nextAttemptAt");

CREATE TABLE "SlackConnection" (
  "userId" UUID PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
  generation UUID NOT NULL,
  "teamId" TEXT,
  "teamName" TEXT,
  "channelId" TEXT,
  "channelName" TEXT,
  "webhookEncrypted" TEXT,
  "connectedAt" TIMESTAMPTZ(3),
  "disconnectedAt" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT
);
CREATE TABLE "SlackOAuthState" (
  id TEXT PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sessionHash" TEXT NOT NULL,
  generation UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "SlackOAuthState_expiresAt_idx" ON "SlackOAuthState" ("expiresAt");
CREATE INDEX "SlackOAuthState_userId_sessionHash_idx" ON "SlackOAuthState" ("userId", "sessionHash");
