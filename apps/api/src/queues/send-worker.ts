import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";
import { z } from "zod";
import type { Logger } from "pino";
import type { Database } from "@repo/db";
import type { DeliveryEnvironment } from "../config/delivery-environment.js";
import type { SchedulingEnvironment } from "../config/scheduling-environment.js";
import type { DeliveryRepository } from "../modules/delivery/delivery.repository.js";
import type { SenderGate } from "../modules/delivery/sender-gate.js";
import { SmtpFailure } from "../modules/delivery/smtp-result.js";
import type { SmtpSender } from "../modules/delivery/smtp.js";
import { decryptCredentials } from "../modules/senders/credentials.js";
import { redisConnection, type Queues, type SendJob } from "./queues.js";
import { attachmentStore } from "../modules/attachments/attachment-store.js";

const payload = z.object({ emailId: z.uuid() }).strict();
async function postpone(
  job: Job<SendJob>,
  at: Date,
  token?: string,
): Promise<never> {
  await job.moveToDelayed(Math.max(Date.now() + 50, at.getTime()), token);
  throw new DelayedError();
}

export function createSendWorker(
  database: Database,
  queues: Queues,
  repository: DeliveryRepository,
  senderGate: SenderGate,
  sendSmtp: SmtpSender,
  scheduling: SchedulingEnvironment,
  delivery: DeliveryEnvironment,
  logger: Logger,
) {
  const worker = new Worker<SendJob>(
    queues.send.name,
    async (job, token) => {
      const parsed = payload.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError("Invalid email job");
      let decision: Awaited<ReturnType<DeliveryRepository["reserve"]>>;
      try {
        decision = await repository.reserve(parsed.data.emailId);
      } catch {
        logger.warn(
          { emailId: parsed.data.emailId },
          "Delivery preparation postponed",
        );
        return await postpone(
          job,
          new Date(Date.now() + scheduling.DISPATCH_RETRY_MS),
          token,
        );
      }
      if (decision.type === "skip") return;
      if (decision.type === "defer") return postpone(job, decision.at, token);
      const claim = decision;
      let outcome;
      try {
        let credentials;
        try {
          credentials = decryptCredentials(
            claim.credentialsEncrypted,
            scheduling.CREDENTIAL_ENCRYPTION_KEY,
            claim.ownerId,
            claim.identity,
          );
        } catch {
          throw new SmtpFailure("permanent", "SMTP_CREDENTIALS_UNAVAILABLE");
        }
        const batch = await database.emailBatch.findUniqueOrThrow({
          where: { id: claim.batchId },
          include: { attachments: true },
        });
        let attachments;
        try {
          attachments = await Promise.all(
            batch.attachments.map(async (file) => ({
              filename: file.filename,
              contentType: file.contentType,
              content: await attachmentStore.read(file),
            })),
          );
        } catch {
          throw new SmtpFailure("permanent", "ATTACHMENT_UNAVAILABLE");
        }
        if (!(await repository.begin(claim)))
          throw new SmtpFailure("retryable", "DELIVERY_NOT_STARTED");
        try {
          outcome = await sendSmtp(credentials, {
            recipient: claim.recipient,
            subject: claim.subject,
            body: claim.body,
            bodyHtml: batch.bodyHtml,
            attachments,
            messageId: claim.messageId,
          });
        } catch (error) {
          outcome =
            error instanceof SmtpFailure
              ? error
              : new SmtpFailure("uncertain", "SMTP_OUTCOME_UNCERTAIN");
        }
      } catch (error) {
        outcome =
          error instanceof SmtpFailure
            ? error
            : new SmtpFailure("retryable", "DELIVERY_NOT_STARTED");
      }
      let result;
      try {
        result = await repository.finish(claim, outcome);
        logger.info(
          {
            emailId: claim.emailId,
            attemptId: claim.attemptId,
            outcome: outcome instanceof SmtpFailure ? outcome.code : "SENT",
          },
          "Delivery attempt recorded",
        );
      } catch {
        logger.warn(
          { emailId: claim.emailId, attemptId: claim.attemptId },
          "Delivery record unavailable; recovery will verify the outstanding attempt before any retry",
        );
        return await postpone(
          job,
          new Date(Date.now() + scheduling.DISPATCH_RETRY_MS),
          token,
        );
      } finally {
        await senderGate
          .release(claim.namespace, claim.identity, claim.attemptId)
          .catch(() => {});
      }
      if (result.type === "defer") return postpone(job, result.at, token);
    },
    {
      connection: redisConnection(queues.redisUrl, true),
      prefix: queues.prefix,
      concurrency: delivery.WORKER_CONCURRENCY,
      lockDuration: delivery.SEND_LEASE_MS,
      maxStalledCount: 2,
    },
  );
  worker.on("error", () => logger.warn("Send worker connection unavailable"));
  worker.on("failed", (job) => {
    logger.warn(
      { jobId: job?.id },
      "Send job interrupted; durable recovery requested",
    );
    if (job && payload.safeParse(job.data).success)
      void database.email
        .findUnique({
          where: { id: job.data.emailId },
          select: { batchId: true },
        })
        .then((email) =>
          email ? queues.enqueueBatch(email.batchId) : undefined,
        )
        .catch(() =>
          logger.warn("Worker restart will retry durable send recovery"),
        );
  });
  return {
    async start() {
      await worker.waitUntilReady();
    },
    async close() {
      await worker.close();
    },
  };
}
