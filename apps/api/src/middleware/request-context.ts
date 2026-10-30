import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { Logger } from "pino";

export function requestContext(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    response.locals.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");
    response.on("finish", () => {
      logger.info(
        {
          requestId,
          method: request.method,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        "Request completed",
      );
    });
    next();
  };
}
