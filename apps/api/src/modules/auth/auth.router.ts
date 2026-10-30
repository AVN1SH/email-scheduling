import { createHash, randomBytes } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import session from "express-session";
import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type PublicUser,
} from "@repo/shared";
import { z } from "zod";
import type { AuthEnvironment } from "../../config/auth-environment.js";
import { AuthError } from "./auth-error.js";
import type { AuthService } from "./auth.service.js";
import type { GoogleProvider } from "./google-provider.js";
import { SESSION_COOKIE } from "./session-store.js";
import { sessionCookie } from "./session-middleware.js";
import { equalTokens, requireJsonOrigin } from "./security.js";

const randomToken = () => randomBytes(32).toString("base64url");
const saveSession = (request: Request) =>
  new Promise<void>((resolve, reject) =>
    request.session.save((error) => (error ? reject(error) : resolve())),
  );

export type AuthRouterOptions = {
  environment: AuthEnvironment;
  service: AuthService;
  google: GoogleProvider;
  store: session.Store;
  rateLimit: RequestHandler;
};

export function createAuthRouter({
  environment,
  service,
  google,
  rateLimit,
}: AuthRouterOptions) {
  const router = Router();
  const cookie = sessionCookie(environment);
  router.use(requireJsonOrigin(environment.APP_URL));

  const signIn = async (
    request: Request,
    user: PublicUser,
  ): Promise<AuthResponse> => {
    await new Promise<void>((resolve, reject) =>
      request.session.regenerate((error) =>
        error ? reject(error) : resolve(),
      ),
    );
    request.session.userId = user.id;
    request.session.csrfToken = randomToken();
    await saveSession(request);
    return { user, csrfToken: request.session.csrfToken };
  };

  router.post("/register", rateLimit, async (request, response) => {
    const input = registerRequestSchema.safeParse(request.body);
    if (!input.success)
      throw new AuthError(
        400,
        "INVALID_INPUT",
        "Enter a name, valid email, and a password between 12 and 128 characters.",
      );
    response
      .status(201)
      .json(await signIn(request, await service.register(input.data)));
  });

  router.post("/login", rateLimit, async (request, response) => {
    const input = loginRequestSchema.safeParse(request.body);
    if (!input.success)
      throw new AuthError(
        400,
        "INVALID_INPUT",
        "Enter a valid email and password.",
      );
    response.json(await signIn(request, await service.login(input.data)));
  });

  router.get("/me", async (request, response) => {
    const user = await service.currentUser(request.session.userId);
    if (!request.session.csrfToken) {
      request.session.csrfToken = randomToken();
      await saveSession(request);
    }
    response.json({
      user,
      csrfToken: request.session.csrfToken,
    } satisfies AuthResponse);
  });

  router.post("/logout", async (request, response) => {
    await service.currentUser(request.session.userId);
    if (!equalTokens(request.get("x-csrf-token"), request.session.csrfToken))
      throw new AuthError(
        403,
        "INVALID_CSRF",
        "Refresh the page and try again.",
      );
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    response.clearCookie(SESSION_COOKIE, {
      path: cookie.path,
      httpOnly: true,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
    });
    response.status(204).end();
  });

  router.get("/google", rateLimit, async (request, response) => {
    const state = randomToken(),
      nonce = randomToken(),
      verifier = randomToken();
    if (!request.session.userId) request.session.cookie.maxAge = 10 * 60 * 1000;
    request.session.googleOAuth = {
      state,
      nonce,
      verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    await saveSession(request);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    response.redirect(
      google.authorizationUrl({ state, nonce, verifier, challenge }),
    );
  });

  router.get("/google/callback", async (request, response) => {
    const parsed = z
      .object({
        state: z.string().max(256),
        code: z.string().max(4096).optional(),
        error: z.string().max(100).optional(),
      })
      .safeParse(request.query);
    const challenge = request.session.googleOAuth;
    if (
      !parsed.success ||
      !challenge ||
      challenge.expiresAt <= Date.now() ||
      !equalTokens(parsed.data.state, challenge.state)
    ) {
      response.redirect(`${environment.APP_URL}/login?error=oauth_state`);
      return;
    }
    delete request.session.googleOAuth;
    await saveSession(request);
    if (parsed.data.error || !parsed.data.code) {
      response.redirect(`${environment.APP_URL}/login?error=oauth_cancelled`);
      return;
    }
    try {
      const identity = await google.exchange(
        parsed.data.code,
        challenge.verifier,
        challenge.nonce,
      );
      await signIn(request, await service.googleLogin(identity));
    } catch (error) {
      const reason =
        error instanceof AuthError && error.code === "ACCOUNT_EXISTS"
          ? "account_exists"
          : "oauth_failed";
      response.redirect(`${environment.APP_URL}/login?error=${reason}`);
      return;
    }
    response.redirect(`${environment.APP_URL}/dashboard`);
  });

  return router;
}
