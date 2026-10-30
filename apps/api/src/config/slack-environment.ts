import { z } from "zod";
import { ConfigurationError } from "./environment.js";

const schema = z.object({
  SLACK_CLIENT_ID: z.string().regex(/^\d+\.\d+$/),
  SLACK_CLIENT_SECRET: z.string().min(1),
  SLACK_REDIRECT_URI: z.url({ protocol: /^https$/ }).refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/api/integrations/slack/callback"
    );
  }),
});
export function parseSlackEnvironment(
  environment: Record<string, string | undefined>,
) {
  if (
    ![
      environment.SLACK_CLIENT_ID,
      environment.SLACK_CLIENT_SECRET,
      environment.SLACK_REDIRECT_URI,
    ].some(Boolean)
  )
    return undefined;
  const parsed = schema.safeParse(environment);
  if (!parsed.success)
    throw new ConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  return parsed.data;
}
export type SlackEnvironment = NonNullable<
  ReturnType<typeof parseSlackEnvironment>
>;
