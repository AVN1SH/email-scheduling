import { DelayedError, Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { redisConnection } from "./queues.js";

export function createSlackWorker(
  drain: () => Promise<number>,
  redisUrl: string,
  prefix: string,
  redis: Redis,
  logger: Logger,
) {
  const queue = new Queue("slack-notifications", {
    connection: redisConnection(redisUrl),
    prefix,
  });
  const worker = new Worker(
    "slack-notifications",
    async (job, token) => {
      let delay = 1000;
      try {
        if (await drain()) delay = 50;
      } catch {
        delay = 5000;
        logger.warn(
          "Slack notification recovery will retry; email delivery continues",
        );
      }
      await job.moveToDelayed(Date.now() + delay, token);
      throw new DelayedError();
    },
    { connection: redisConnection(redisUrl, true), prefix, autorun: false },
  );
  queue.on("error", () => logger.warn("Slack queue connection unavailable"));
  worker.on("error", () => logger.warn("Slack worker connection unavailable"));
  async function recover() {
    const job = await queue.getJob("recover");
    if (job && (await job.getState()) === "failed") await job.retry();
    else
      await queue.add(
        "recover",
        {},
        { jobId: "recover", removeOnComplete: true },
      );
  }
  const onReady = () => {
    void recover().catch(() =>
      logger.warn("Slack queue recovery will retry after reconnect"),
    );
  };
  worker.on("failed", onReady);
  return {
    async start() {
      redis.on("ready", onReady);
      void worker
        .run()
        .catch(() => logger.error("Slack notification worker stopped"));
      await recover();
    },
    async close() {
      redis.off("ready", onReady);
      await worker.close();
      await queue.close();
    },
  };
}
