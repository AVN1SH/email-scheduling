import type { Database, Prisma } from "@repo/db";
import type { ScheduleRequest, ScheduleResponse } from "@repo/shared";
import { createEmailQueries, emailSummary } from "../emails/email-queries.js";
import { AppError } from "../../errors/app-error.js";
import type { SchedulingEnvironment } from "../../config/scheduling-environment.js";
import { normalizeRecipients, scheduleHash } from "./schedule-input.js";
import { messageContent } from "../compose/message-content.js";
import { claimAttachments } from "../attachments/attachments.service.js";

const senderSelect = { id: true, name: true, email: true } as const;
const batchInclude = {
  emails: { orderBy: [{ requestedAt: "asc" }, { id: "asc" }] },
  sender: { select: senderSelect },
  dispatchEvent: { select: { publishedAt: true } },
} satisfies Prisma.EmailBatchInclude;
type Batch = Prisma.EmailBatchGetPayload<{ include: typeof batchInclude }>;
function scheduleResponse(
  batch: Batch,
  duplicates: string[],
  replayed: boolean,
): ScheduleResponse {
  return {
    batch: {
      id: batch.id,
      senderId: batch.senderId,
      subject: batch.subject,
      body: batch.body,
      startAt: batch.startAt.toISOString(),
      delayMs: batch.delayMs,
      hourlyLimit: batch.hourlyLimit,
      recipientCount: batch.emails.length,
      createdAt: batch.createdAt.toISOString(),
    },
    emails: batch.emails.map((email) => emailSummary(email, batch)),
    duplicateRecipients: duplicates,
    replayed,
    dispatchStatus: batch.dispatchEvent?.publishedAt ? "published" : "pending",
  };
}

export function createSchedulingService(
  database: Database,
  settings: SchedulingEnvironment,
) {
  return {
    ...createEmailQueries(database),
    async schedule(userId: string, key: string, input: ScheduleRequest) {
      const { recipients, duplicates } = normalizeRecipients(input.recipients);
      const requestHash = scheduleHash(input);
      const findExisting = () =>
        database.emailBatch.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
          include: batchInclude,
        });
      const replay = (batch: Batch) => {
        if (batch.requestHash !== requestHash)
          throw new AppError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key was already used for another request.",
          );
        return scheduleResponse(batch, duplicates, true);
      };
      const existing = await findExisting();
      if (existing) return replay(existing);
      const delayMs = input.delayMs ?? settings.MIN_EMAIL_DELAY_MS;
      const hourlyLimit =
        input.hourlyLimit ?? settings.MAX_EMAILS_PER_HOUR_PER_SENDER;
      if (delayMs < settings.MIN_EMAIL_DELAY_MS)
        throw new AppError(
          400,
          "DELAY_TOO_SHORT",
          `Delay must be at least ${settings.MIN_EMAIL_DELAY_MS} ms.`,
        );
      if (hourlyLimit > settings.MAX_EMAILS_PER_HOUR_PER_SENDER)
        throw new AppError(
          400,
          "LIMIT_TOO_HIGH",
          `Hourly limit must be at most ${settings.MAX_EMAILS_PER_HOUR_PER_SENDER}.`,
        );
      const sender = await database.sender.findFirst({
        where: { id: input.senderId, userId, active: true },
        select: { id: true },
      });
      if (!sender)
        throw new AppError(404, "SENDER_NOT_FOUND", "Sender not found.");
      const startAt = new Date(input.startAt);
      const content = messageContent(input.body, input.bodyHtml);
      try {
        const created = await database.$transaction(
          async (tx) => {
            const batch = await tx.emailBatch.create({
              data: {
                userId,
                senderId: sender.id,
                idempotencyKey: key,
                requestHash,
                namespace: settings.QUEUE_PREFIX,
                subject: input.subject,
                ...content,
                startAt,
                delayMs,
                hourlyLimit,
              },
            });
            await claimAttachments(
              tx,
              userId,
              batch.id,
              input.attachmentIds ?? [],
            );
            await tx.email.createMany({
              data: recipients.map((recipient, index) => {
                const at = new Date(startAt.getTime() + index * delayMs);
                return {
                  batchId: batch.id,
                  recipient,
                  requestedAt: at,
                  scheduledAt: at,
                };
              }),
            });
            await tx.dispatchEvent.create({ data: { batchId: batch.id } });
            return batch;
          },
          { timeout: 30000 },
        );
        const batch = await database.emailBatch.findUniqueOrThrow({
          where: { id: created.id },
          include: batchInclude,
        });
        return scheduleResponse(batch, duplicates, false);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        ) {
          const batch = await findExisting();
          if (batch) return replay(batch);
        }
        throw error;
      }
    },
  };
}
export type SchedulingService = ReturnType<typeof createSchedulingService>;
