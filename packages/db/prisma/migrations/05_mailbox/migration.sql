-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Email_deletedAt_archived_status_idx" ON "Email"("deletedAt", "archived", "status");
