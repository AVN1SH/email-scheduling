import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default("redis://127.0.0.1:6379"),
});

export class ConfigurationError extends Error {
  constructor(fields: string[]) {
    super(
      `Invalid configuration: ${fields.join(", ")}. Check apps/api/.env or the process environment.`,
    );
    this.name = "ConfigurationError";
  }
}

export function parseEnvironment(
  environment: Record<string, string | undefined>,
) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError(
      [
        ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
      ].sort(),
    );
  }
  return result.data;
}

export function loadEnvironment() {
  const path = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(path)) loadEnvFile(path);
  return parseEnvironment(process.env);
}

export type Environment = ReturnType<typeof parseEnvironment>;
