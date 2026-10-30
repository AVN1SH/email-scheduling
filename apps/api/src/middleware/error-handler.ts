import type { ErrorRequestHandler } from "express";
import type { ApiError } from "@repo/shared";
import type { Logger } from "pino";
import { AppError } from "../errors/app-error.js";

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const type =
      error && typeof error === "object" && "type" in error
        ? error.type
        : undefined;
    const isInvalidJson = type === "entity.parse.failed";
    const isTooLarge = type === "entity.too.large";
    const status = isInvalidJson ? 400 : isTooLarge ? 413 : 500;
    const requestId: string = response.locals.requestId;
    if (error instanceof AppError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      } satisfies ApiError);
      return;
    }
    if (status === 500) {
      logger.error(
        {
          requestId,
          errorType: error instanceof Error ? error.name : "Unknown",
        },
        "Request failed",
      );
    }

    const body: ApiError = {
      error: {
        code: isInvalidJson
          ? "INVALID_JSON"
          : isTooLarge
            ? "PAYLOAD_TOO_LARGE"
            : "INTERNAL_ERROR",
        message: isInvalidJson
          ? "Request body must contain valid JSON."
          : isTooLarge
            ? "Request body is too large."
            : "An unexpected error occurred.",
        requestId,
      },
    };
    response.status(status).json(body);
  };
}
