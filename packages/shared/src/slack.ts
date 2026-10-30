import { z } from "zod";

export const slackStatusSchema = z.object({
  configured: z.boolean(),
  ready: z.boolean(),
  connection: z
    .object({
      teamName: z.string(),
      channelName: z.string(),
      connectedAt: z.iso.datetime(),
      needsReconnect: z.boolean(),
    })
    .nullable(),
});
export const slackAuthorizationSchema = z.object({ authorizationUrl: z.url() });
export type SlackStatus = z.infer<typeof slackStatusSchema>;
