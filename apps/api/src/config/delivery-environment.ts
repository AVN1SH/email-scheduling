import { z } from "zod";
import { ConfigurationError } from "./environment.js";

const schema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(3000).max(120000).default(30000),
  MAX_SEND_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SEND_RETRY_BASE_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(5000),
});

export function parseDeliveryEnvironment(
  environment: Record<string, string | undefined>,
) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success)
    throw new ConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  return { ...parsed.data, SEND_LEASE_MS: parsed.data.SMTP_TIMEOUT_MS + 60000 };
}
export type DeliveryEnvironment = ReturnType<typeof parseDeliveryEnvironment>;
