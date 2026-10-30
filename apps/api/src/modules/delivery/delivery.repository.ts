import { randomUUID } from "node:crypto";
import type { Database, Prisma } from "@repo/db";
import type { DeliveryEnvironment } from "../../config/delivery-environment.js";
import type { SchedulingEnvironment } from "../../config/scheduling-environment.js";
import { gateKey, hourlyWindow, type SenderGate } from "./sender-gate.js";
import { SmtpFailure, type SmtpResult } from "./smtp-result.js";
import { lockSender } from "./sender-lock.js";

export const recoverableStatuses = [
  "PENDING_DISPATCH",
  "SCHEDULED",
  "PROCESSING",
  "RETRYING",
] as const;
const pendingStatuses = ["PENDING_DISPATCH", "SCHEDULED", "RETRYING"] as const;
type Transaction = Prisma.TransactionClient;
type Deferred = { type: "defer"; at: Date; reason: string };
type Skipped = { type: "skip" };
export type ClaimedDelivery = {
  type: "send";
  emailId: string;
  batchId: string;
  attemptId: string;
  number: number;
  namespace: string;
  identity: string;
  ownerId: string;
  credentialsEncrypted: string;
  recipient: string;
  subject: string;
  body: string;
  messageId: string;
  spacingMs: number;
};
export type DeliveryDecision = ClaimedDelivery | Deferred | Skipped;

async function databaseTime(tx: Transaction) {
  const [result] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return result!.now;
}

async function recoverExpiredAttempt(
  tx: Transaction,
  attemptId: string,
  now: Date,
) {
  const attempt = await tx.deliveryAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt || !["RESERVED", "SMTP_STARTED"].includes(attempt.outcome))
    return;
  const uncertain = attempt.outcome === "SMTP_STARTED";
  await tx.deliveryAttempt.update({
    where: { id: attempt.id },
    data: {
      outcome: uncertain ? "UNCERTAIN" : "ABANDONED",
      finishedAt: now,
      errorCode: uncertain
        ? "SMTP_OUTCOME_UNCERTAIN"
        : "WORKER_INTERRUPTED_BEFORE_SMTP",
    },
  });
  await tx.email.updateMany({
    where: {
      id: attempt.emailId,
      status: "PROCESSING",
      activeAttemptId: attempt.id,
    },
    data: {
      status: uncertain ? "DELIVERY_UNCERTAIN" : "RETRYING",
      activeAttemptId: null,
      scheduledAt: now,
      lastErrorCode: uncertain
        ? "SMTP_OUTCOME_UNCERTAIN"
        : "WORKER_INTERRUPTED_BEFORE_SMTP",
      deferredReason: uncertain ? null : "RECOVERY",
    },
  });
}

export function createDeliveryRepository(
  database: Database,
  senderGate: SenderGate,
  scheduling: SchedulingEnvironment,
  delivery: DeliveryEnvironment,
) {
  const namespace = scheduling.QUEUE_PREFIX;
  const busyDelay = Math.max(1000, scheduling.MIN_EMAIL_DELAY_MS);
  const deferEmail = async (
    tx: Transaction,
    emailId: string,
    at: Date,
    reason: string,
  ) => {
    await tx.email.updateMany({
      where: { id: emailId, status: { in: [...pendingStatuses] } },
      data: { scheduledAt: at, deferredReason: reason },
    });
    return { type: "defer", at, reason } as const;
  };
  const notifyLimits = async (
    tx: Transaction,
    batch: {
      id: string;
      userId: string;
      hourlyLimit: number;
      sender: { identityKey: string };
    },
    now: Date,
    senderReached: boolean,
    batchReached: boolean,
  ) => {
    if (!senderReached && !batchReached) return;
    const window = hourlyWindow(now);
    const common = {
      namespace,
      identityKey: batch.sender.identityKey,
      windowStart: window.start,
      resetsAt: window.end,
      createdAt: now,
      nextAttemptAt: now,
    };
    let senderCoversBatch = false;
    if (senderReached) {
      const owners = await tx.sender.findMany({
        where: { identityKey: batch.sender.identityKey, active: true },
        distinct: ["userId"],
        select: { userId: true },
      });
      await tx.senderLimitEvent.createMany({
        data: owners.map((owner) => ({
          ...common,
          userId: owner.userId,
          scopeKey: "sender",
          batchId:
            batchReached && owner.userId === batch.userId ? batch.id : null,
          limit: scheduling.MAX_EMAILS_PER_HOUR_PER_SENDER,
        })),
        skipDuplicates: true,
      });
      if (batchReached) {
        const event = await tx.senderLimitEvent.findFirst({
          where: {
            userId: batch.userId,
            namespace,
            identityKey: batch.sender.identityKey,
            windowStart: window.start,
            scopeKey: "sender",
          },
          select: { batchId: true },
        });
        // Remember which batch the sender alert covers so later blocked jobs cannot duplicate it.
        senderCoversBatch = event?.batchId === batch.id;
      }
    }
    if (batchReached && !senderCoversBatch)
      await tx.senderLimitEvent.createMany({
        data: [
          {
            ...common,
            userId: batch.userId,
            scopeKey: `batch:${batch.id}`,
            batchId: batch.id,
            limit: batch.hourlyLimit,
          },
        ],
        skipDuplicates: true,
      });
  };

  return {
    async reserve(emailId: string): Promise<DeliveryDecision> {
      const source = await database.email.findUnique({
        where: { id: emailId },
        include: { batch: { include: { sender: true } } },
      });
      if (
        !source ||
        source.deletedAt ||
        source.batch.namespace !== namespace ||
        !recoverableStatuses.includes(
          source.status as (typeof recoverableStatuses)[number],
        )
      )
        return { type: "skip" };
      const identity = source.batch.sender.identityKey,
        key = gateKey(namespace, identity),
        attemptId = randomUUID();
      try {
        return await database.$transaction(
          async (tx) => {
            await lockSender(tx, key);
            const now = await databaseTime(tx);
            let email = await tx.email.findUnique({ where: { id: emailId } });
            if (
              !email ||
              email.deletedAt ||
              !recoverableStatuses.includes(
                email.status as (typeof recoverableStatuses)[number],
              )
            )
              return { type: "skip" } as const;
            let state = await tx.senderGate.upsert({
              where: { key },
              create: { key, nextAllowedAt: new Date(0) },
              update: {},
            });
            if (
              state.leaseToken &&
              state.leaseExpiresAt &&
              state.leaseExpiresAt <= now
            ) {
              const previous = await tx.deliveryAttempt.findUnique({
                where: { id: state.leaseToken },
              });
              await recoverExpiredAttempt(tx, state.leaseToken, now);
              await senderGate.release(namespace, identity, state.leaseToken);
              state = await tx.senderGate.update({
                where: { key },
                data: {
                  leaseToken: null,
                  leaseExpiresAt: null,
                  nextAllowedAt: new Date(
                    Math.max(
                      state.nextAllowedAt.getTime(),
                      now.getTime() +
                        (previous?.spacingMs ?? scheduling.MIN_EMAIL_DELAY_MS),
                    ),
                  ),
                },
              });
              email = await tx.email.findUniqueOrThrow({
                where: { id: emailId },
              });
            }
            if (email.status === "PROCESSING" && email.activeAttemptId) {
              const attempt = await tx.deliveryAttempt.findUnique({
                where: { id: email.activeAttemptId },
              });
              if (attempt && attempt.leaseExpiresAt > now)
                return {
                  type: "defer",
                  at: new Date(
                    Math.min(
                      attempt.leaseExpiresAt.getTime(),
                      now.getTime() + busyDelay,
                    ),
                  ),
                  reason: "SENDER_BUSY",
                } as const;
              await recoverExpiredAttempt(tx, email.activeAttemptId, now);
              email = await tx.email.findUniqueOrThrow({
                where: { id: emailId },
              });
            }
            if (
              !pendingStatuses.includes(
                email.status as (typeof pendingStatuses)[number],
              )
            )
              return { type: "skip" } as const;
            if (email.scheduledAt > now)
              return {
                type: "defer",
                at: email.scheduledAt,
                reason: email.deferredReason ?? "SCHEDULED",
              } as const;
            if (
              !source.batch.sender.active ||
              email.attemptsMade >= delivery.MAX_SEND_ATTEMPTS
            ) {
              await tx.email.update({
                where: { id: emailId },
                data: {
                  status: "FAILED",
                  failedAt: now,
                  lastErrorCode: !source.batch.sender.active
                    ? "SENDER_INACTIVE"
                    : "SMTP_RETRIES_EXHAUSTED",
                  deferredReason: null,
                },
              });
              return { type: "skip" } as const;
            }
            if (
              state.leaseToken &&
              state.leaseExpiresAt &&
              state.leaseExpiresAt > now
            )
              return deferEmail(
                tx,
                emailId,
                new Date(
                  Math.min(
                    state.leaseExpiresAt.getTime(),
                    now.getTime() + busyDelay,
                  ),
                ),
                "SENDER_BUSY",
              );
            const window = hourlyWindow(now),
              spacingMs = Math.max(
                source.batch.delayMs,
                scheduling.MIN_EMAIL_DELAY_MS,
              );
            const senderUsed = await tx.deliveryAttempt.count({
              where: {
                namespace,
                identityKey: identity,
                windowStart: window.start,
              },
            });
            const batchUsed = await tx.deliveryAttempt.count({
              where: { batchId: source.batchId, windowStart: window.start },
            });
            const reservation = await senderGate.reserve({
              now,
              namespace,
              identity,
              batchId: source.batchId,
              token: attemptId,
              leaseMs: delivery.SEND_LEASE_MS,
              spacingMs,
              senderUsed,
              batchUsed,
              nextAllowedAt: state.nextAllowedAt,
              senderLimit: scheduling.MAX_EMAILS_PER_HOUR_PER_SENDER,
              batchLimit: source.batch.hourlyLimit,
            });
            if (!reservation.allowed) {
              if (
                reservation.reason === "SENDER_HOURLY_LIMIT" ||
                reservation.reason === "BATCH_HOURLY_LIMIT"
              )
                await notifyLimits(
                  tx,
                  source.batch,
                  now,
                  reservation.senderUsed >=
                    scheduling.MAX_EMAILS_PER_HOUR_PER_SENDER,
                  reservation.batchUsed >= source.batch.hourlyLimit,
                );
              return deferEmail(
                tx,
                emailId,
                reservation.eligibleAt,
                reservation.reason,
              );
            }
            const number = email.attemptsMade + 1,
              messageId =
                email.messageId ??
                `<email.${email.id}@email-scheduler.invalid>`;
            const claimed = await tx.email.updateMany({
              where: {
                id: emailId,
                status: { in: [...pendingStatuses] },
                attemptsMade: email.attemptsMade,
              },
              data: {
                status: "PROCESSING",
                attemptsMade: { increment: 1 },
                activeAttemptId: attemptId,
                messageId,
                deferredReason: null,
              },
            });
            if (claimed.count !== 1) {
              await senderGate.release(namespace, identity, attemptId);
              return { type: "skip" } as const;
            }
            const leaseExpiresAt = new Date(
              now.getTime() + delivery.SEND_LEASE_MS,
            );
            await tx.deliveryAttempt.create({
              data: {
                id: attemptId,
                emailId,
                batchId: source.batchId,
                namespace,
                identityKey: identity,
                number,
                spacingMs,
                windowStart: window.start,
                reservedAt: now,
                leaseExpiresAt,
                messageId,
              },
            });
            await tx.senderGate.update({
              where: { key },
              data: {
                leaseToken: attemptId,
                leaseExpiresAt,
                nextAllowedAt: new Date(now.getTime() + spacingMs),
              },
            });
            await notifyLimits(
              tx,
              source.batch,
              now,
              reservation.senderUsed >=
                scheduling.MAX_EMAILS_PER_HOUR_PER_SENDER,
              reservation.batchUsed >= source.batch.hourlyLimit,
            );
            return {
              type: "send",
              emailId,
              batchId: source.batchId,
              attemptId,
              number,
              namespace,
              identity,
              ownerId: source.batch.userId,
              credentialsEncrypted: source.batch.sender.credentialsEncrypted,
              recipient: email.recipient,
              subject: source.batch.subject,
              body: source.batch.body,
              messageId,
              spacingMs,
            } as const;
          },
          { timeout: 30000, maxWait: 10000 },
        );
      } catch (error) {
        await senderGate
          .release(namespace, identity, attemptId)
          .catch(() => {});
        throw error;
      }
    },
    async begin(claim: ClaimedDelivery) {
      return database.$transaction(
        async (tx) => {
          await lockSender(tx, gateKey(namespace, claim.identity));
          const now = await databaseTime(tx);
          const state = await tx.senderGate.findUnique({
            where: { key: gateKey(namespace, claim.identity) },
          });
          const email = await tx.email.findUnique({
            where: { id: claim.emailId },
          });
          if (
            state?.leaseToken !== claim.attemptId ||
            !state.leaseExpiresAt ||
            state.leaseExpiresAt.getTime() <=
              now.getTime() + delivery.SMTP_TIMEOUT_MS + 5000 ||
            email?.activeAttemptId !== claim.attemptId ||
            email.status !== "PROCESSING" ||
            email.deletedAt
          )
            return false;
          const result = await tx.deliveryAttempt.updateMany({
            where: { id: claim.attemptId, outcome: "RESERVED" },
            data: { outcome: "SMTP_STARTED", startedAt: now },
          });
          return result.count === 1;
        },
        { timeout: 15000, maxWait: 10000 },
      );
    },
    async finish(
      claim: ClaimedDelivery,
      result: SmtpResult | SmtpFailure,
    ): Promise<Deferred | Skipped> {
      return database.$transaction(
        async (tx) => {
          await lockSender(tx, gateKey(namespace, claim.identity));
          const now = await databaseTime(tx);
          const email = await tx.email.findUnique({
            where: { id: claim.emailId },
          });
          if (
            email?.activeAttemptId !== claim.attemptId ||
            email.status !== "PROCESSING"
          )
            return { type: "skip" } as const;
          const failed = result instanceof SmtpFailure,
            retry =
              failed &&
              result.kind === "retryable" &&
              claim.number < delivery.MAX_SEND_ATTEMPTS;
          const at = new Date(
            now.getTime() +
              Math.min(
                3600000,
                delivery.SEND_RETRY_BASE_MS * 2 ** (claim.number - 1),
              ),
          );
          const status = !failed
            ? "SENT"
            : retry
              ? "RETRYING"
              : result.kind === "uncertain"
                ? "DELIVERY_UNCERTAIN"
                : "FAILED";
          await tx.deliveryAttempt.update({
            where: { id: claim.attemptId },
            data: {
              outcome: !failed
                ? "SENT"
                : result.kind === "uncertain"
                  ? "UNCERTAIN"
                  : result.kind === "retryable"
                    ? "RETRYABLE_FAILURE"
                    : "PERMANENT_FAILURE",
              finishedAt: now,
              errorCode: failed ? result.code : null,
              smtpResponseCode: failed ? result.responseCode : null,
            },
          });
          await tx.email.update({
            where: { id: claim.emailId },
            data: {
              status,
              activeAttemptId: null,
              ...(retry ? { scheduledAt: at } : {}),
              sentAt: !failed ? now : null,
              failedAt: status === "FAILED" ? now : null,
              lastErrorCode: failed
                ? result.kind === "retryable" && !retry
                  ? "SMTP_RETRIES_EXHAUSTED"
                  : result.code
                : null,
              deferredReason: retry ? "RETRY_BACKOFF" : null,
              previewUrl: !failed ? result.previewUrl : null,
            },
          });
          await tx.senderGate.updateMany({
            where: {
              key: gateKey(namespace, claim.identity),
              leaseToken: claim.attemptId,
            },
            data: {
              leaseToken: null,
              leaseExpiresAt: null,
              nextAllowedAt: new Date(now.getTime() + claim.spacingMs),
            },
          });
          return retry
            ? ({ type: "defer", at, reason: "RETRY_BACKOFF" } as const)
            : ({ type: "skip" } as const);
        },
        { timeout: 15000, maxWait: 10000 },
      );
    },
  };
}
export type DeliveryRepository = ReturnType<typeof createDeliveryRepository>;
