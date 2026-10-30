import { z } from "zod";
import { ConfigurationError } from "./environment.js";

const schema = z.object({
  CREDENTIAL_ENCRYPTION_KEY: z.string().refine((value) => {
    const key = Buffer.from(value, "base64");
    return key.length === 32 && key.toString("base64") === value;
  }),
  MIN_EMAIL_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(86400000)
    .default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(200),
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.email())),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default("email-scheduler"),
  DISPATCH_RETRY_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
});

export function parseSchedulingEnvironment(
  environment: Record<string, string | undefined>,
) {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new ConfigurationError(
      [
        ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
      ].sort(),
    );
  return result.data;
}
export type SchedulingEnvironment = ReturnType<
  typeof parseSchedulingEnvironment
>;
