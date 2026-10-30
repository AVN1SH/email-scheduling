import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
import { AuthError } from "./auth-error.js";

const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('TTL', KEYS[1])}
`;

export function createAuthRateLimit(redis: Redis): RequestHandler {
  return async (request, response, next) => {
    const client = createHash("sha256")
      .update(request.socket.remoteAddress ?? "unknown")
      .digest("hex");
    const bucket = request.path === "/google" ? "google" : "password";
    let result: unknown;
    try {
      result = await redis.eval(
        script,
        1,
        `email-scheduler:auth-limit:${bucket}:${client}`,
        900,
      );
    } catch {
      throw new AuthError(
        503,
        "AUTH_UNAVAILABLE",
        "Sign-in is temporarily unavailable. Try again shortly.",
      );
    }
    if (!Array.isArray(result) || result.length !== 2)
      throw new AuthError(
        503,
        "AUTH_UNAVAILABLE",
        "Sign-in is temporarily unavailable.",
      );
    if (Number(result[0]) > 30) {
      response.setHeader("Retry-After", String(Math.max(Number(result[1]), 1)));
      throw new AuthError(
        429,
        "TOO_MANY_ATTEMPTS",
        "Too many sign-in attempts. Try again later.",
      );
    }
    next();
  };
}
