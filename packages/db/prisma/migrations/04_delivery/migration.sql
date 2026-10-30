-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('RESERVED', 'SMTP_STARTED', 'SENT', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'UNCERTAIN', 'ABANDONED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "EmailStatus" ADD VALUE 'RETRYING';
ALTER TYPE "EmailStatus" ADD VALUE 'SENT';
ALTER TYPE "EmailStatus" ADD VALUE 'FAILED';
ALTER TYPE "EmailStatus" ADD VALUE 'DELIVERY_UNCERTAIN';
ALTER TYPE "EmailStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "EmailBatch" ADD COLUMN     "namespace" TEXT NOT NULL DEFAULT 'email-scheduler';

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "activeAttemptId" UUID,
ADD COLUMN     "attemptsMade" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deferredReason" TEXT,
ADD COLUMN     "failedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "previewUrl" TEXT,
ADD COLUMN     "sentAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "emailId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "spacingMs" INTEGER NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "DeliveryOutcome" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "smtpResponseCode" INTEGER,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderGate" (
    "key" TEXT NOT NULL,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextAllowedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SenderGate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SenderLimitEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "resetsAt" TIMESTAMPTZ(3) NOT NULL,
    "limit" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SenderLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryAttempt_namespace_identityKey_windowStart_idx" ON "DeliveryAttempt"("namespace", "identityKey", "windowStart");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_batchId_windowStart_idx" ON "DeliveryAttempt"("batchId", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_emailId_number_key" ON "DeliveryAttempt"("emailId", "number");

-- CreateIndex
CREATE INDEX "SenderLimitEvent_notifiedAt_idx" ON "SenderLimitEvent"("notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SenderLimitEvent_userId_namespace_identityKey_windowStart_key" ON "SenderLimitEvent"("userId", "namespace", "identityKey", "windowStart");

-- CreateIndex
CREATE INDEX "EmailBatch_namespace_createdAt_idx" ON "EmailBatch"("namespace", "createdAt");

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderLimitEvent" ADD CONSTRAINT "SenderLimitEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
