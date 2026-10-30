import type { Database } from "@repo/db";
import type { Logger } from "pino";
import type { SchedulingEnvironment } from "../../config/scheduling-environment.js";
import { createAuthRepository } from "../auth/auth.repository.js";
import { createSendersService } from "../senders/senders.service.js";
import { createQueues } from "../../queues/queues.js";
import { createSchedulingService } from "./scheduling.service.js";
import { createEmailActions } from "../emails/email-actions.service.js";
import type { Redis } from "ioredis";
import { createAttachmentsService } from "../attachments/attachments.service.js";
import { createSearchService } from "../search/search.service.js";
import type { SearchClient } from "../search/search-client.js";

export function createSchedulingModules(
  database: Database,
  redisUrl: string,
  settings: SchedulingEnvironment,
  logger: Logger,
  redis: Redis,
  search?: SearchClient,
) {
  const queues = createQueues(redisUrl, settings.QUEUE_PREFIX, logger);
  return {
    queues,
    search: createSearchService(database, search),
    senders: createSendersService(database, settings.CREDENTIAL_ENCRYPTION_KEY),
    scheduling: createSchedulingService(database, settings),
    actions: createEmailActions(database, queues, redis),
    attachments: createAttachmentsService(database),
    settings,
    repository: createAuthRepository(database),
    adminEmails: settings.ADMIN_EMAILS,
    logger,
  };
}
