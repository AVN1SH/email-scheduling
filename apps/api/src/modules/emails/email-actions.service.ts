import type { Database } from "@repo/db";
import type { EmailUpdate } from "@repo/shared";
import type { Queues } from "../../queues/queues.js";
import { sendJobId } from "../../queues/queues.js";
import { AppError } from "../../errors/app-error.js";
import { lockSender } from "../delivery/sender-lock.js";
import { gateKey, createSenderGate } from "../delivery/sender-gate.js";
import type { Redis } from "ioredis";
import { createEmailQueries } from "./email-queries.js";

export function createEmailActions(
  database: Database,
  queues: Queues,
  redis: Redis,
) {
  const queries = createEmailQueries(database),
    gate = createSenderGate(redis);
  return {
    async update(userId: string, id: string, input: EmailUpdate) {
      const result = await database.email.updateMany({
        where: { id, deletedAt: null, batch: { userId } },
        data: input,
      });
      if (!result.count)
        throw new AppError(404, "EMAIL_NOT_FOUND", "Email not found.");
      return queries.detail(userId, id);
    },
    async remove(userId: string, id: string) {
      const source = await database.email.findFirst({
        where: { id, batch: { userId } },
        select: {
          batch: {
            select: {
              namespace: true,
              sender: { select: { identityKey: true } },
            },
          },
        },
      });
      if (!source)
        throw new AppError(404, "EMAIL_NOT_FOUND", "Email not found.");
      const namespace = source.batch.namespace,
        identity = source.batch.sender.identityKey;
      const released = await database.$transaction(
        async (tx) => {
          await lockSender(tx, gateKey(namespace, identity));
          const email = await tx.email.findFirst({
            where: { id, batch: { userId } },
          });
          if (!email)
            throw new AppError(404, "EMAIL_NOT_FOUND", "Email not found.");
          if (email.deletedAt) return null;
          const now = new Date();
          let token: string | null = null;
          if (email.status === "PROCESSING") {
            const attempt = email.activeAttemptId
              ? await tx.deliveryAttempt.findUnique({
                  where: { id: email.activeAttemptId },
                })
              : null;
            if (!attempt || attempt.outcome !== "RESERVED")
              throw new AppError(
                409,
                "EMAIL_SENDING",
                "Sending has already started. Try deleting this email after delivery finishes.",
              );
            await tx.deliveryAttempt.update({
              where: { id: attempt.id },
              data: {
                outcome: "ABANDONED",
                finishedAt: now,
                errorCode: "CANCELLED_BEFORE_SMTP",
              },
            });
            await tx.senderGate.updateMany({
              where: {
                key: gateKey(namespace, identity),
                leaseToken: attempt.id,
              },
              data: { leaseToken: null, leaseExpiresAt: null },
            });
            token = attempt.id;
          }
          const cancel = [
            "PENDING_DISPATCH",
            "SCHEDULED",
            "RETRYING",
            "PROCESSING",
          ].includes(email.status);
          await tx.email.update({
            where: { id },
            data: {
              deletedAt: now,
              ...(cancel
                ? {
                    status: "CANCELLED",
                    activeAttemptId: null,
                    deferredReason: null,
                  }
                : {}),
            },
          });
          return token;
        },
        { timeout: 15000, maxWait: 10000 },
      );
      if (released)
        await gate.release(namespace, identity, released).catch(() => {});
      if (namespace === queues.prefix) {
        const job = await queues.send.getJob(sendJobId(id)).catch(() => null);
        if (job) await job.remove().catch(() => {});
      }
    },
  };
}
export type EmailActions = ReturnType<typeof createEmailActions>;
