import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { z } from "zod";
import type { AuthEnvironment } from "../../config/auth-environment.js";
import { AuthError } from "./auth-error.js";

export type GoogleIdentity = {
  subject: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};
export type GoogleChallenge = {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
};
export interface GoogleProvider {
  authorizationUrl(challenge: GoogleChallenge): string;
  exchange(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<GoogleIdentity>;
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string(),
  name: z.string().max(200).optional(),
  picture: z.url({ protocol: /^https$/ }).optional(),
});

export function readVerifiedGoogleIdentity(
  payload: unknown,
  nonce: string,
): GoogleIdentity {
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success || claims.data.nonce !== nonce) {
    throw new AuthError(
      401,
      "OAUTH_FAILED",
      "Google identity verification failed.",
    );
  }
  return {
    subject: claims.data.sub,
    email: claims.data.email.toLowerCase(),
    name: claims.data.name ?? null,
    avatarUrl: claims.data.picture ?? null,
  };
}

export function createGoogleProvider(
  environment: AuthEnvironment,
): GoogleProvider {
  const client = new OAuth2Client({
    clientId: environment.GOOGLE_CLIENT_ID,
    clientSecret: environment.GOOGLE_CLIENT_SECRET,
    redirectUri: environment.GOOGLE_REDIRECT_URI,
    transporterOptions: { timeout: 10_000, retry: false },
  });
  return {
    authorizationUrl: (value) =>
      client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        access_type: "online",
        prompt: "select_account",
        state: value.state,
        nonce: value.nonce,
        code_challenge: value.challenge,
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    async exchange(code, verifier, nonce) {
      const { tokens } = await client.getToken({
        code,
        codeVerifier: verifier,
        redirect_uri: environment.GOOGLE_REDIRECT_URI,
      });
      if (!tokens.id_token)
        throw new AuthError(
          401,
          "OAUTH_FAILED",
          "Google did not return a valid identity.",
        );
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: environment.GOOGLE_CLIENT_ID,
      });
      return readVerifiedGoogleIdentity(ticket.getPayload(), nonce);
    },
  };
}
