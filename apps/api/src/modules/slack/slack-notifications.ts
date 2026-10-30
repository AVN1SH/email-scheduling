import { randomUUID } from "node:crypto";
import type { Database, Prisma } from "@repo/db";
import { decryptWebhook } from "./slack-credentials.js";
import { lockSlackUser } from "./slack-lock.js";
import type { SlackWebhook } from "./slack-webhook.js";
import { slackTime as clock } from "./slack-clock.js";

const pending = ["PENDING_DISPATCH", "SCHEDULED", "RETRYING"] as const;
const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function createSlackNotifications(
  database: Database,
  key: string,
  namespace: string,
  post: SlackWebhook,
) {
  const options = { timeout: 15000, maxWait: 10000 };
  const deferredWhere = (event: {
    userId: string;
    identityKey: string;
    resetsAt: Date;
    scopeKey: string;
    batchId: string | null;
  }): Prisma.EmailWhereInput => ({
    batchId: event.scopeKey === "sender" ? undefined : event.batchId!,
    deletedAt: null,
    status: { in: [...pending] },
    requestedAt: { lt: event.resetsAt },
    batch: {
      namespace,
      userId: event.userId,
      sender: { identityKey: event.identityKey },
    },
  });
  async function claim(eventId: string, userId: string) {
    return database.$transaction(async (tx) => {
      await lockSlackUser(tx, userId);
      const now = await clock(tx);
      const event = await tx.senderLimitEvent.findFirst({
        where: {
          id: eventId,
          userId,
          namespace,
          notifiedAt: null,
          notificationState: { in: ["PENDING", "RETRYING"] },
          nextAttemptAt: { lte: now },
          resetsAt: { gt: now },
        },
      });
      const connection = await tx.slackConnection.findUnique({
        where: { userId },
      });
      if (
        !event ||
        !connection?.webhookEncrypted ||
        !connection.connectedAt ||
        connection.disconnectedAt
      )
        return undefined;
      if (
        connection.connectedAt > event.createdAt &&
        !(await tx.email.count({ where: deferredWhere(event) }))
      ) {
        await tx.senderLimitEvent.update({
          where: { id: eventId },
          data: { nextAttemptAt: new Date(now.getTime() + 10000) },
        });
        return undefined;
      }
      const token = randomUUID();
      // Commit the in-flight marker before the external request; an interrupted post is not blindly repeated.
      await tx.senderLimitEvent.update({
        where: { id: eventId },
        data: {
          notificationState: "SENDING",
          notificationAttempts: { increment: 1 },
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + 30000),
          connectionGeneration: connection.generation,
        },
      });
      return { eventId, userId, token };
    }, options);
  }
  async function deliver(claimed: {
    eventId: string;
    userId: string;
    token: string;
  }) {
    await database.$transaction(async (tx) => {
      // Disconnect takes the same lock and cannot complete while this user has a post in flight.
      await lockSlackUser(tx, claimed.userId);
      const now = await clock(tx);
      const event = await tx.senderLimitEvent.findFirst({
        where: {
          id: claimed.eventId,
          namespace,
          userId: claimed.userId,
          leaseToken: claimed.token,
          notificationState: "SENDING",
        },
      });
      if (!event) return;
      if (!event.leaseExpiresAt || event.leaseExpiresAt <= now) return;
      if (event.resetsAt <= now) {
        await tx.senderLimitEvent.update({
          where: { id: event.id },
          data: {
            notificationState: "EXPIRED",
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        return;
      }
      const connection = await tx.slackConnection.findUnique({
        where: { userId: claimed.userId },
      });
      if (
        !connection?.webhookEncrypted ||
        connection.disconnectedAt ||
        connection.generation !== event.connectionGeneration
      ) {
        await tx.senderLimitEvent.update({
          where: { id: event.id },
          data: {
            notificationState: "PENDING",
            leaseToken: null,
            leaseExpiresAt: null,
            connectionGeneration: null,
            nextAttemptAt: now,
          },
        });
        return;
      }
      const sender = await tx.sender.findFirst({
        where: { userId: event.userId, identityKey: event.identityKey },
        select: { name: true, email: true },
      });
      if (!sender) {
        await tx.senderLimitEvent.update({
          where: { id: event.id },
          data: {
            notificationState: "FAILED",
            lastNotificationError: "SLACK_SENDER_UNAVAILABLE",
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        return;
      }
      const batch = event.batchId
        ? await tx.emailBatch.findFirst({
            where: {
              id: event.batchId,
              userId: event.userId,
              namespace,
              sender: { identityKey: event.identityKey },
            },
            select: { subject: true, hourlyLimit: true },
          })
        : null;
      if (event.scopeKey !== "sender" && !batch) {
        await tx.senderLimitEvent.update({
          where: { id: event.id },
          data: {
            notificationState: "EXPIRED",
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        return;
      }
      const count = await tx.email.count({ where: deferredWhere(event) });
      const isBatchEvent = event.scopeKey !== "sender";
      const title = isBatchEvent
        ? "Batch hourly limit reached"
        : batch
          ? "Sender and batch hourly limits reached"
          : "Sender hourly limit reached";
      const limits = isBatchEvent
        ? `Batch hourly limit: ${event.limit}`
        : `Sender hourly limit: ${event.limit}${batch ? `\nBatch hourly limit: ${batch.hourlyLimit}` : ""}`;
      const context = batch
        ? `\nBatch: ${escapeText(batch.subject)}\nBatch ID: ${event.batchId}`
        : "";
      const text = `${title}\nSender: ${escapeText(sender.name)} (${escapeText(sender.email)})${context}\n${limits}\nQueued emails deferred: ${count}\nResets: ${event.resetsAt.toISOString()} (UTC)`;
      let result;
      try {
        result = await post(
          decryptWebhook(
            connection.webhookEncrypted,
            key,
            connection.userId,
            connection.generation,
          ),
          text,
        );
      } catch {
        result = {
          type: "failed" as const,
          code: "SLACK_CREDENTIALS_UNAVAILABLE",
        };
      }
      const retry = result.type === "retry" && event.notificationAttempts < 5;
      const finishedAt = await clock(tx);
      await tx.senderLimitEvent.update({
        where: { id: event.id },
        data: {
          notificationState:
            result.type === "sent"
              ? "SENT"
              : retry
                ? "RETRYING"
                : result.type === "uncertain"
                  ? "UNCERTAIN"
                  : "FAILED",
          notifiedAt: result.type === "sent" ? finishedAt : null,
          lastNotificationError: result.type === "sent" ? null : result.code,
          leaseToken: null,
          leaseExpiresAt: null,
          ...(retry
            ? {
                nextAttemptAt: new Date(
                  finishedAt.getTime() +
                    Math.max(
                      result.type === "retry" ? (result.retryAfterMs ?? 0) : 0,
                      Math.min(
                        60000,
                        1000 * 2 ** (event.notificationAttempts - 1),
                      ),
                    ),
                ),
              }
            : {}),
        },
      });
      if (result.type === "failed" || (result.type === "retry" && !retry))
        await tx.slackConnection.update({
          where: { userId: connection.userId },
          data: { lastErrorCode: result.code },
        });
    }, options);
  }
  return {
    claim,
    deliver,
    async drain() {
      const now = await clock(database);
      await database.senderLimitEvent.updateMany({
        where: {
          namespace,
          notificationState: "SENDING",
          leaseExpiresAt: { lte: now },
        },
        data: {
          notificationState: "UNCERTAIN",
          leaseToken: null,
          leaseExpiresAt: null,
          lastNotificationError: "SLACK_OUTCOME_UNCERTAIN",
        },
      });
      await database.senderLimitEvent.updateMany({
        where: {
          namespace,
          notificationState: { in: ["PENDING", "RETRYING"] },
          resetsAt: { lte: now },
        },
        data: { notificationState: "EXPIRED" },
      });
      const events = await database.senderLimitEvent.findMany({
        where: {
          namespace,
          notificationState: { in: ["PENDING", "RETRYING"] },
          nextAttemptAt: { lte: now },
          resetsAt: { gt: now },
          notifiedAt: null,
          user: {
            slackConnection: {
              webhookEncrypted: { not: null },
              disconnectedAt: null,
            },
          },
        },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
        take: 10,
        select: { id: true, userId: true },
      });
      let processed = 0;
      for (const event of events) {
        const reservation = await claim(event.id, event.userId);
        if (reservation) {
          await deliver(reservation);
          processed++;
        }
      }
      return processed;
    },
  };
}
