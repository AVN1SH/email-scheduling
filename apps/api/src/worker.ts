import { ConfigurationError, loadEnvironment } from "./config/environment.js";
import { createInfrastructure } from "./config/infrastructure.js";
import { createLogger } from "./config/logger.js";
import { checkReadiness } from "./modules/health/readiness.js";
import { installShutdown } from "./shutdown.js";
import { parseSchedulingEnvironment } from "./config/scheduling-environment.js";
import { createQueues } from "./queues/queues.js";
import { createDispatcher } from "./queues/dispatcher.js";
import { createDispatchRepository } from "./queues/dispatch.repository.js";
import { parseDeliveryEnvironment } from "./config/delivery-environment.js";
import { createDeliveryRepository } from "./modules/delivery/delivery.repository.js";
import { createSenderGate } from "./modules/delivery/sender-gate.js";
import { createSmtpSender } from "./modules/delivery/smtp.js";
import { createSendWorker } from "./queues/send-worker.js";
import { createSearchClient } from "./modules/search/search-client.js";
import { createSearchIndex } from "./modules/search/search-index.js";
import { createSearchWorker } from "./queues/search-worker.js";
import { createSlackWorker } from "./queues/slack-worker.js";
import { createSlackNotifications } from "./modules/slack/slack-notifications.js";
import { createSlackWebhook } from "./modules/slack/slack-webhook.js";

async function main() {
  const environment = loadEnvironment();
  const scheduling = parseSchedulingEnvironment(process.env);
  const delivery = parseDeliveryEnvironment(process.env);
  const logger = createLogger("worker", environment.LOG_LEVEL);
  const search = createSearchClient();
  const infrastructure = createInfrastructure(environment, logger);
  const readiness = await checkReadiness(infrastructure.checks, 12_000);
  if (readiness.status !== "ready") {
    logger.error(
      { services: readiness.services },
      "Worker dependencies unavailable",
    );
    await infrastructure.close();
    process.exitCode = 1;
    return;
  }

  const queues = createQueues(
    environment.REDIS_URL,
    scheduling.QUEUE_PREFIX,
    logger,
  );
  const dispatcher = createDispatcher(
    createDispatchRepository(infrastructure.database, scheduling.QUEUE_PREFIX),
    queues,
    infrastructure.redis,
    logger,
    scheduling.DISPATCH_RETRY_MS,
  );
  const gate = createSenderGate(infrastructure.redis);
  const slackWorker = createSlackWorker(
    createSlackNotifications(
      infrastructure.database,
      scheduling.CREDENTIAL_ENCRYPTION_KEY,
      scheduling.QUEUE_PREFIX,
      createSlackWebhook(),
    ).drain,
    environment.REDIS_URL,
    scheduling.QUEUE_PREFIX,
    infrastructure.redis,
    logger,
  );
  const searchWorker = search
    ? createSearchWorker(
        createSearchIndex(infrastructure.database, search).sync,
        environment.REDIS_URL,
        scheduling.QUEUE_PREFIX,
        infrastructure.redis,
        logger,
      )
    : undefined;
  const sender = createSendWorker(
    infrastructure.database,
    queues,
    createDeliveryRepository(
      infrastructure.database,
      gate,
      scheduling,
      delivery,
    ),
    gate,
    createSmtpSender(delivery.SMTP_TIMEOUT_MS),
    scheduling,
    delivery,
    logger,
  );
  try {
    await sender.start();
    await dispatcher.start();
    await searchWorker?.start();
    await slackWorker.start();
  } catch (error) {
    await slackWorker.close();
    await searchWorker?.close();
    await search?.client.close();
    await sender.close();
    await dispatcher.close();
    await queues.close();
    await infrastructure.close();
    throw error;
  }
  logger.info(
    { concurrency: delivery.WORKER_CONCURRENCY },
    "Dispatch and SMTP workers ready",
  );
  installShutdown(
    logger,
    async () => {
      await slackWorker.close();
      await searchWorker?.close();
      await search?.client.close();
      await dispatcher.close();
      await sender.close();
      await queues.close();
      await infrastructure.close();
    },
    delivery.SMTP_TIMEOUT_MS + 60000,
  );
}

main().catch((error: unknown) => {
  createLogger("worker").error(
    error instanceof ConfigurationError
      ? error.message
      : "Worker startup failed. Check configuration and service availability.",
  );
  process.exitCode = 1;
});
