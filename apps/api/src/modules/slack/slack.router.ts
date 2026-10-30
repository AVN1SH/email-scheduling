import { Router } from "express";
import { z } from "zod";
import type { AuthRouterOptions } from "../auth/auth.router.js";
import {
  requireUser,
  currentUser,
  requireCsrf,
  requireJsonOrigin,
} from "../auth/security.js";
import { AppError } from "../../errors/app-error.js";
import type { SlackEnvironment } from "../../config/slack-environment.js";
import type { SlackService } from "./slack.service.js";
import type { SlackProvider } from "./slack-provider.js";

export type SlackRouterOptions = {
  service: SlackService;
  provider?: SlackProvider;
  environment?: SlackEnvironment;
};
export function createSlackRouter(
  auth: AuthRouterOptions,
  options: SlackRouterOptions,
) {
  const router = Router();
  const configured = !!options.provider && !!options.environment;
  const ready =
    configured &&
    new URL(options.environment!.SLACK_REDIRECT_URI).origin ===
      auth.environment.APP_URL;
  router.use(requireJsonOrigin(auth.environment.APP_URL), requireCsrf);
  router.get("/callback", async (request, response) => {
    const target = `${auth.environment.APP_URL}/dashboard/settings`;
    if (!request.session.userId) {
      response.redirect(`${auth.environment.APP_URL}/login`);
      return;
    }
    await auth.service.currentUser(request.session.userId);
    const parsed = z
      .object({
        state: z.string().min(1).max(256),
        code: z.string().min(1).max(4096).optional(),
        error: z.string().max(100).optional(),
      })
      .safeParse(request.query);
    if (!ready || !parsed.success) {
      response.redirect(`${target}?slack=invalid_state`);
      return;
    }
    const generation = await options.service.consume(
      request.session.userId,
      request.sessionID,
      parsed.data.state,
    );
    if (!generation) {
      response.redirect(`${target}?slack=invalid_state`);
      return;
    }
    if (parsed.data.error || !parsed.data.code) {
      response.redirect(`${target}?slack=cancelled`);
      return;
    }
    try {
      const grant = await options.provider!.exchange(parsed.data.code);
      const saved = await options.service.connect(
        request.session.userId,
        generation,
        grant,
      );
      response.redirect(`${target}?slack=${saved ? "connected" : "changed"}`);
    } catch {
      response.redirect(`${target}?slack=failed`);
    }
  });
  router.use(requireUser(auth.service));
  router.get("/", async (_request, response) => {
    response.json({
      configured,
      ready,
      connection: await options.service.status(currentUser(response).id),
    });
  });
  router.post("/connect", auth.rateLimit, async (request, response) => {
    if (!configured)
      throw new AppError(
        503,
        "SLACK_UNAVAILABLE",
        "Slack is not configured yet.",
      );
    if (!ready)
      throw new AppError(
        409,
        "SLACK_ORIGIN_MISMATCH",
        "Slack requires the app and callback to use the same HTTPS address. Complete the HTTPS setup and sign in there.",
      );
    const state = await options.service.begin(
      currentUser(response).id,
      request.sessionID,
    );
    response.json({
      authorizationUrl: options.provider!.authorizationUrl(state),
    });
  });
  router.delete("/", async (_request, response) => {
    await options.service.disconnect(currentUser(response).id);
    response.status(204).end();
  });
  return router;
}
