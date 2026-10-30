import { z } from "zod";
export * from "./auth.js";
export * from "./scheduling.js";
export * from "./compose.js";
export * from "./slack.js";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
});

const dependencyStatusSchema = z.enum(["up", "down"]);

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  services: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
