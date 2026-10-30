import { randomUUID } from "node:crypto";
import { Queue, type RedisOptions } from "bullmq";
import type { Logger } from "pino";

export type SendJob = { emailId: string };
export type DispatchJob =
  { type: "batch"; batchId: string } | { type: "recover" };
export const sendJobId = (emailId: string) => `email-${emailId}`;

export function redisConnection(url: string, worker = false): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: decodeURIComponent(parsed.username) || undefined,
    password: decodeURIComponent(parsed.password) || undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    connectTimeout: 5000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    ...(worker ? {} : { commandTimeout: 5000 }),
  };
}

export function createQueues(redisUrl: string, prefix: string, logger: Logger) {
  const options = { connection: redisConnection(redisUrl), prefix };
  const send = new Queue<SendJob>("email-send", options);
  const dispatch = new Queue<DispatchJob>("email-dispatch", options);
  for (const queue of [send, dispatch])
    queue.on("error", () =>
      logger.warn({ queue: queue.name }, "Queue connection unavailable"),
    );
  return {
    send,
    dispatch,
    prefix,
    redisUrl,
    async enqueueBatch(batchId: string) {
      const jobId = `dispatch-${batchId}`;
      const existing = await dispatch.getJob(jobId);
      if (existing && (await existing.getState()) === "failed") {
        await existing.retry();
        return;
      }
      await dispatch.add(
        "publish-batch",
        { type: "batch", batchId },
        { jobId, removeOnComplete: true, removeOnFail: 1000 },
      );
    },
    async recover() {
      await dispatch.add(
        "recover-outbox",
        { type: "recover" },
        {
          jobId: `recover-${randomUUID()}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    },
    async close() {
      await Promise.all([send.close(), dispatch.close()]);
    },
  };
}
export type Queues = ReturnType<typeof createQueues>;
