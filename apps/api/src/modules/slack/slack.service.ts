import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@repo/db";
import { encryptWebhook } from "./slack-credentials.js";
import type { SlackGrant } from "./slack-provider.js";
import { lockSlackUser } from "./slack-lock.js";
import { slackTime } from "./slack-clock.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createSlackService(
  database: Database,
  key: string,
  namespace: string,
) {
  const options = { timeout: 15000, maxWait: 10000 };
  return {
    async status(userId: string) {
      const connection = await database.slackConnection.findUnique({
        where: { userId },
      });
      return connection?.webhookEncrypted &&
        connection.connectedAt &&
        !connection.disconnectedAt
        ? {
            teamName: connection.teamName!,
            channelName: connection.channelName!,
            connectedAt: connection.connectedAt.toISOString(),
            needsReconnect: !!connection.lastErrorCode,
          }
        : null;
    },
    async begin(userId: string, sessionId: string) {
      const token = randomBytes(32).toString("base64url");
      await database.$transaction(async (tx) => {
        await lockSlackUser(tx, userId);
        const now = await slackTime(tx);
        const connection = await tx.slackConnection.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        await tx.slackOAuthState.deleteMany({
          where: {
            OR: [
              { expiresAt: { lte: now } },
              { userId, sessionHash: hash(sessionId) },
            ],
          },
        });
        await tx.slackOAuthState.create({
          data: {
            id: hash(token),
            userId,
            sessionHash: hash(sessionId),
            generation: connection.generation,
            expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          },
        });
      }, options);
      return token;
    },
    async consume(userId: string, sessionId: string, token: string) {
      return database.$transaction(async (tx) => {
        await lockSlackUser(tx, userId);
        const now = await slackTime(tx);
        const challenge = await tx.slackOAuthState.findFirst({
          where: {
            id: hash(token),
            userId,
            sessionHash: hash(sessionId),
            consumedAt: null,
            expiresAt: { gt: now },
          },
        });
        if (!challenge) return undefined;
        const claimed = await tx.slackOAuthState.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: now },
        });
        const connection = await tx.slackConnection.findUnique({
          where: { userId },
        });
        return claimed.count === 1 &&
          connection?.generation === challenge.generation
          ? challenge.generation
          : undefined;
      }, options);
    },
    async connect(
      userId: string,
      expectedGeneration: string,
      grant: SlackGrant,
    ) {
      return database.$transaction(async (tx) => {
        await lockSlackUser(tx, userId);
        const now = await slackTime(tx);
        const generation = randomUUID();
        const updated = await tx.slackConnection.updateMany({
          where: { userId, generation: expectedGeneration },
          data: {
            generation,
            webhookEncrypted: encryptWebhook(
              grant.incoming_webhook.url,
              key,
              userId,
              generation,
            ),
            teamId: grant.team.id,
            teamName: grant.team.name,
            channelId: grant.incoming_webhook.channel_id,
            channelName: grant.incoming_webhook.channel,
            connectedAt: now,
            disconnectedAt: null,
            lastErrorCode: null,
          },
        });
        if (!updated.count) return false;
        await tx.slackOAuthState.deleteMany({ where: { userId } });
        await tx.senderLimitEvent.updateMany({
          where: {
            userId,
            namespace,
            notifiedAt: null,
            resetsAt: { gt: now },
            notificationState: "FAILED",
          },
          data: {
            notificationState: "PENDING",
            notificationAttempts: 0,
            nextAttemptAt: now,
            lastNotificationError: null,
          },
        });
        return true;
      }, options);
    },
    async disconnect(userId: string) {
      await database.$transaction(
        async (tx) => {
          await lockSlackUser(tx, userId);
          const now = await slackTime(tx);
          await tx.slackConnection.upsert({
            where: { userId },
            create: { userId, disconnectedAt: now },
            update: {
              generation: randomUUID(),
              webhookEncrypted: null,
              disconnectedAt: now,
              lastErrorCode: null,
            },
          });
          await tx.slackOAuthState.deleteMany({ where: { userId } });
        },
        { timeout: 15000, maxWait: 10000 },
      );
    },
  };
}
export type SlackService = ReturnType<typeof createSlackService>;
