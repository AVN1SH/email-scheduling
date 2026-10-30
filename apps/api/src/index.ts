import { createServer } from "node:http";
import { createApp } from "./app.js";
import { ConfigurationError, loadEnvironment } from "./config/environment.js";
import { createInfrastructure } from "./config/infrastructure.js";
import { createLogger } from "./config/logger.js";
import { installShutdown } from "./shutdown.js";
import { parseAuthEnvironment } from "./config/auth-environment.js";
import { createAuthRepository } from "./modules/auth/auth.repository.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { createGoogleProvider } from "./modules/auth/google-provider.js";
import { PostgresSessionStore } from "./modules/auth/session-store.js";
import { createAuthRateLimit } from "./modules/auth/rate-limit.js";
import { parseSchedulingEnvironment } from "./config/scheduling-environment.js";
import { createSchedulingModules } from "./modules/scheduling/modules.js";
import { createSearchClient } from "./modules/search/search-client.js";
import { parseSlackEnvironment } from "./config/slack-environment.js";
import { createSlackProvider } from "./modules/slack/slack-provider.js";
import { createSlackService } from "./modules/slack/slack.service.js";

async function main() {
  const environment = loadEnvironment();
  const authEnvironment = parseAuthEnvironment(process.env);
  const schedulingEnvironment = parseSchedulingEnvironment(process.env);
  const slackEnvironment = parseSlackEnvironment(process.env);
  const logger = createLogger("api", environment.LOG_LEVEL);
  const search = createSearchClient();
  const infrastructure = createInfrastructure(environment, logger);
  const scheduling = createSchedulingModules(
    infrastructure.database,
    environment.REDIS_URL,
    schedulingEnvironment,
    logger,
    infrastructure.redis,
    search,
  );
  const server = createServer(
    createApp(
      infrastructure.checks,
      logger,
      {
        environment: authEnvironment,
        service: createAuthService(
          createAuthRepository(infrastructure.database),
        ),
        google: createGoogleProvider(authEnvironment),
        store: new PostgresSessionStore(infrastructure.database),
        rateLimit: createAuthRateLimit(infrastructure.redis),
      },
      scheduling,
      {
        environment: slackEnvironment,
        provider: slackEnvironment
          ? createSlackProvider(slackEnvironment)
          : undefined,
        service: createSlackService(
          infrastructure.database,
          schedulingEnvironment.CREDENTIAL_ENCRYPTION_KEY,
          schedulingEnvironment.QUEUE_PREFIX,
        ),
      },
    ),
  );

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(environment.PORT, environment.HOST, resolve);
    });
  } catch (error) {
    await search?.client.close();
    await scheduling.queues.close();
    await infrastructure.close();
    throw error;
  }

  logger.info(
    { host: environment.HOST, port: environment.PORT },
    "API listening",
  );
  installShutdown(logger, async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await search?.client.close();
    await scheduling.queues.close();
    await infrastructure.close();
  });
}

main().catch((error: unknown) => {
  createLogger("api").error(
    error instanceof ConfigurationError
      ? error.message
      : "API startup failed. Check configuration, service availability, and the port.",
  );
  process.exitCode = 1;
});
