import express from "express";
import type { ApiError, HealthResponse } from "@repo/shared";
import type { Logger } from "pino";
import { errorHandler } from "./middleware/error-handler.js";
import { requestContext } from "./middleware/request-context.js";
import {
  checkReadiness,
  type ReadinessChecks,
} from "./modules/health/readiness.js";
import {
  createAuthRouter,
  type AuthRouterOptions,
} from "./modules/auth/auth.router.js";
import { createSessionMiddleware } from "./modules/auth/session-middleware.js";
import {
  createSchedulingRouter,
  type SchedulingRouterOptions,
} from "./modules/scheduling/scheduling.router.js";
import {
  createSlackRouter,
  type SlackRouterOptions,
} from "./modules/slack/slack.router.js";

export function createApp(
  checks: ReadinessChecks,
  logger: Logger,
  auth?: AuthRouterOptions,
  scheduling?: SchedulingRouterOptions,
  slack?: SlackRouterOptions,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext(logger));
  app.use("/attachments", express.json({ limit: "7mb" }));
  app.use("/leads/parse", express.json({ limit: "2mb" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "api" } satisfies HealthResponse);
  });

  app.get("/ready", async (_request, response) => {
    const result = await checkReadiness(checks);
    response.status(result.status === "ready" ? 200 : 503).json(result);
  });

  if (auth) {
    app.use(createSessionMiddleware(auth.environment, auth.store));
    app.use("/auth", createAuthRouter(auth));
    if (slack) app.use("/integrations/slack", createSlackRouter(auth, slack));
    if (scheduling) app.use(createSchedulingRouter(auth, scheduling));
  }

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: response.locals.requestId,
      },
    } satisfies ApiError);
  });
  app.use(errorHandler(logger));

  return app;
}
