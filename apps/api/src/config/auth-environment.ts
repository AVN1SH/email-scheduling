import { z } from "zod";
import { ConfigurationError } from "./environment.js";

const schema = z
  .object({
    APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:8000"),
    SESSION_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_REDIRECT_URI: z.url({ protocol: /^https?$/ }).optional(),
  })
  .superRefine((value, context) => {
    const origin = new URL(value.APP_URL);
    if (
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      context.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "Use an origin without credentials, path, or query.",
      });
    }
    if (
      value.GOOGLE_REDIRECT_URI &&
      value.GOOGLE_REDIRECT_URI !== `${origin.origin}/api/auth/google/callback`
    ) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_REDIRECT_URI"],
        message: "Callback must use the configured app origin.",
      });
    }
  });

export function parseAuthEnvironment(
  environment: Record<string, string | undefined>,
) {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new ConfigurationError(
      [
        ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
      ].sort(),
    );
  const appUrl = new URL(result.data.APP_URL).origin;
  return {
    ...result.data,
    APP_URL: appUrl,
    GOOGLE_REDIRECT_URI: `${appUrl}/api/auth/google/callback`,
    secureCookies: appUrl.startsWith("https:"),
  };
}

export type AuthEnvironment = ReturnType<typeof parseAuthEnvironment>;
