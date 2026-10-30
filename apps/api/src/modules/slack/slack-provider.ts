import { z } from "zod";
import type { SlackEnvironment } from "../../config/slack-environment.js";
import { webhookSchema } from "./slack-credentials.js";

const grantSchema = z.object({
  ok: z.literal(true),
  scope: z
    .string()
    .refine((scope) => scope.split(",").includes("incoming-webhook")),
  team: z.object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
  }),
  incoming_webhook: z.object({
    url: webhookSchema,
    channel_id: z.string().min(1).max(100),
    channel: z.string().min(1).max(200),
  }),
});
export type SlackGrant = z.infer<typeof grantSchema>;
export function createSlackProvider(
  environment: SlackEnvironment,
  fetcher: typeof fetch = fetch,
) {
  return {
    authorizationUrl(state: string) {
      const url = new URL("https://slack.com/oauth/v2/authorize");
      url.search = new URLSearchParams({
        client_id: environment.SLACK_CLIENT_ID,
        scope: "incoming-webhook",
        redirect_uri: environment.SLACK_REDIRECT_URI,
        state,
      }).toString();
      return url.toString();
    },
    async exchange(code: string): Promise<SlackGrant> {
      try {
        const response = await fetcher(
          "https://slack.com/api/oauth.v2.access",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(8000),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: environment.SLACK_CLIENT_ID,
              client_secret: environment.SLACK_CLIENT_SECRET,
              code,
              redirect_uri: environment.SLACK_REDIRECT_URI,
            }),
          },
        );
        if (!response.ok) throw new Error();
        return grantSchema.parse(await response.json());
      } catch {
        throw new Error(
          "Slack authorization could not be completed. Please try connecting again.",
        );
      }
    },
  };
}
export type SlackProvider = ReturnType<typeof createSlackProvider>;
