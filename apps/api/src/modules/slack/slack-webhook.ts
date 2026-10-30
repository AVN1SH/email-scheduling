import { webhookSchema } from "./slack-credentials.js";

export type SlackPostResult =
  | { type: "sent" }
  | { type: "retry"; code: string; retryAfterMs?: number }
  | { type: "failed"; code: string }
  | { type: "uncertain"; code: string };
export function createSlackWebhook(fetcher: typeof fetch = fetch) {
  return async (url: string, text: string): Promise<SlackPostResult> => {
    if (!webhookSchema.safeParse(url).success)
      return { type: "failed", code: "SLACK_WEBHOOK_INVALID" };
    try {
      const response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, mrkdwn: false }),
      });
      const body = (await response.text()).trim();
      if (response.ok && body === "ok") return { type: "sent" };
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        return {
          type: "retry",
          code: "SLACK_RATE_LIMITED",
          retryAfterMs:
            Number.isFinite(seconds) && seconds > 0
              ? Math.min(seconds * 1000, 3600000)
              : 1000,
        };
      }
      if (response.status >= 500)
        return { type: "retry", code: "SLACK_TEMPORARILY_UNAVAILABLE" };
      return { type: "failed", code: "SLACK_RECONNECT_REQUIRED" };
    } catch {
      return { type: "uncertain", code: "SLACK_OUTCOME_UNCERTAIN" };
    }
  };
}
export type SlackWebhook = ReturnType<typeof createSlackWebhook>;
