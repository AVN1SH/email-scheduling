import { timingSafeEqual } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { PublicUser } from "@repo/shared";
import { AuthError } from "./auth-error.js";
import type { AuthService } from "./auth.service.js";
import type { AuthRepository } from "./auth.repository.js";

export function equalTokens(
  left: string | undefined,
  right: string | undefined,
) {
  if (!left || !right) return false;
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireJsonOrigin(origin: string): RequestHandler {
  return (request, _response, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.get("origin") !== origin)
        throw new AuthError(
          403,
          "UNTRUSTED_ORIGIN",
          "Request origin is not allowed.",
        );
      if (!request.is("application/json"))
        throw new AuthError(415, "JSON_REQUIRED", "Send a JSON request body.");
    }
    next();
  };
}

export const requireCsrf: RequestHandler = (request, _response, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !equalTokens(request.get("x-csrf-token"), request.session.csrfToken)
  )
    throw new AuthError(403, "INVALID_CSRF", "Refresh the page and try again.");
  next();
};

export function requireUser(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    response.locals.currentUser = await service.currentUser(
      request.session.userId,
    );
    next();
  };
}

export function currentUser(response: Response): PublicUser {
  return response.locals.currentUser as PublicUser;
}

export function requireAdmin(
  repository: AuthRepository,
  emails: string[],
): RequestHandler {
  return async (request, _response, next) => {
    const user = request.session.userId
      ? await repository.findById(request.session.userId)
      : null;
    if (!user)
      throw new AuthError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!user.googleSubject || !emails.includes(user.email.toLowerCase()))
      throw new AuthError(
        403,
        "FORBIDDEN",
        "Administrator access is required.",
      );
    next();
  };
}
