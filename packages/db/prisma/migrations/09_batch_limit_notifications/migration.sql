BEGIN;

ALTER TABLE "SenderLimitEvent"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'sender',
  ADD COLUMN "batchId" UUID,
  ADD CONSTRAINT "SenderLimitEvent_scope_check" CHECK (
    "scopeKey" = 'sender' OR
    ("batchId" IS NOT NULL AND "scopeKey" = 'batch:' || "batchId"::text)
  );

DROP INDEX "SenderLimitEvent_userId_namespace_identityKey_windowStart_key";
CREATE UNIQUE INDEX "SenderLimitEvent_scope_window_key"
  ON "SenderLimitEvent" ("userId", "namespace", "identityKey", "windowStart", "scopeKey");

COMMIT;
