import { DelayedError, UnrecoverableError, Worker } from "bullmq";
import { z } from "zod";
import type { DispatchRepository } from "./dispatch.repository.js";
import type { Logger } from "pino";
import type { Redis } from "ioredis";
import {
  redisConnection,
  sendJobId,
  type DispatchJob,
  type Queues,
} from "./queues.js";

const payload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("batch"), batchId: z.uuid() }).strict(),
  z.object({ type: z.literal("recover") }).strict(),
]);

export async function publishBatch(
  repository: DispatchRepository,
  queues: Queues,
  batchId: string,
) {
  const emails = await repository.emails(batchId);
  for (let offset = 0; offset < emails.length; offset += 500) {
    await queues.send.addBulk(
      emails.slice(offset, offset + 500).map((email) => ({
        name: "send-email",
        data: { emailId: email.id },
        opts: {
          jobId: sendJobId(email.id),
          delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
          removeOnComplete: false,
          removeOnFail: false,
        },
      })),
    );
    for (const email of emails.slice(offset, offset + 500)) {
      const job = await queues.send.getJob(sendJobId(email.id));
      if (job && (await job.getState()) === "failed") await job.retry();
    }
  }
  await repository.acknowledge(batchId);
}

export function createDispatcher(
  repository: DispatchRepository,
  queues: Queues,
  redis: Redis,
  logger: Logger,
  retryMs: number,
) {
  let closing = false;
  const recover = () => {
    if (!closing)
      void queues
        .recover()
        .catch(() =>
          logger.warn(
            "Recovery will retry when Redis reconnects or the worker restarts",
          ),
        );
  };
  const worker = new Worker<DispatchJob>(
    queues.dispatch.name,
    async (job, token) => {
      const parsed = payload.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError("Invalid dispatch job");
      try {
        if (parsed.data.type === "batch")
          await publishBatch(repository, queues, parsed.data.batchId);
        else {
          let cursor: string | undefined;
          do {
            const batches = await repository.recoverableBatches(cursor);
            for (const batch of batches) await queues.enqueueBatch(batch.id);
            cursor = batches.length === 100 ? batches.at(-1)!.id : undefined;
          } while (cursor);
        }
      } catch {
        logger.warn(
          { jobId: job.id },
          "Dispatch postponed; PostgreSQL retains the schedule",
        );
        await job.moveToDelayed(Date.now() + retryMs, token);
        throw new DelayedError();
      }
    },
    {
      connection: redisConnection(queues.redisUrl, true),
      prefix: queues.prefix,
      concurrency: 4,
    },
  );
  worker.on("error", () =>
    logger.warn("Dispatch worker connection unavailable"),
  );
  worker.on("failed", (job) =>
    logger.warn(
      { jobId: job?.id },
      "Dispatch interrupted; recovery runs on reconnect and restart",
    ),
  );
  redis.on("ready", recover);
  return {
    async start() {
      await worker.waitUntilReady();
      await queues.recover();
    },
    async close() {
      closing = true;
      redis.off("ready", recover);
      await worker.close();
    },
  };
}
