import { DelayedError, Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { redisConnection } from "./queues.js";

export function createSearchWorker(
  sync: () => Promise<number>,
  redisUrl: string,
  prefix: string,
  redis: Redis,
  logger: Logger,
) {
  const queue = new Queue("email-search", {
    connection: redisConnection(redisUrl),
    prefix,
  });
  const worker = new Worker(
    "email-search",
    async (job, token) => {
      let delay = 2000;
      try {
        if (await sync()) delay = 50;
      } catch {
        delay = 10000;
        logger.warn(
          "Search indexing unavailable; durable changes will be retried",
        );
      }
      await job.moveToDelayed(Date.now() + delay, token);
      throw new DelayedError();
    },
    { connection: redisConnection(redisUrl, true), prefix, autorun: false },
  );
  queue.on("error", () => logger.warn("Search queue connection unavailable"));
  worker.on("error", () => logger.warn("Search worker connection unavailable"));
  async function recover() {
    const job = await queue.getJob("sync");
    if (job && (await job.getState()) === "failed") await job.retry();
    else await queue.add("sync", {}, { jobId: "sync", removeOnComplete: true });
  }
  const onReady = () => {
    void recover().catch(() =>
      logger.warn("Search recovery will retry after Redis reconnects"),
    );
  };
  worker.on("failed", onReady);
  return {
    async start() {
      redis.on("ready", onReady);
      void worker.run().catch(() => logger.error("Search worker stopped"));
      await recover();
    },
    async close() {
      redis.off("ready", onReady);
      await worker.close();
      await queue.close();
    },
  };
}
