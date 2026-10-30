import { createDatabase } from "@repo/db";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Environment } from "./environment.js";
import type { ReadinessChecks } from "../modules/health/readiness.js";

export function createInfrastructure(environment: Environment, logger: Logger) {
  const database = createDatabase(environment.DATABASE_URL);
  const redis = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 3_000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 3_000),
  });

  let redisUnavailable = false;
  redis.on("error", () => {
    if (!redisUnavailable)
      logger.warn({ dependency: "redis" }, "Redis connection unavailable");
    redisUnavailable = true;
  });
  redis.on("ready", () => {
    redisUnavailable = false;
    logger.info({ dependency: "redis" }, "Redis connected");
  });
  const initialConnection = redis.connect().catch(() => {});

  const checks: ReadinessChecks = {
    database: async () => {
      await database.$queryRaw`SELECT 1`;
    },
    redis: async () => {
      await initialConnection;
      if ((await redis.ping()) !== "PONG")
        throw new Error("Redis health check failed");
    },
  };

  return {
    database,
    redis,
    checks,
    async close() {
      redis.disconnect();
      await database.$disconnect();
    },
  };
}
