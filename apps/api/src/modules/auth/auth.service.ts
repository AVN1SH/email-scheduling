import type { LoginRequest, PublicUser, RegisterRequest } from "@repo/shared";
import { AuthError } from "./auth-error.js";
import type { AuthRecord, AuthRepository } from "./auth.repository.js";
import type { GoogleIdentity } from "./google-provider.js";
import { hashPassword, verifyPassword } from "./password.js";

export function publicUser(user: AuthRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export function createAuthService(repository: AuthRepository) {
  return {
    async register(input: RegisterRequest) {
      if (await repository.findByEmail(input.email))
        throw new AuthError(
          409,
          "ACCOUNT_EXISTS",
          "An account already uses this email. Sign in using its existing login method.",
        );
      return publicUser(
        await repository.create({
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          googleSubject: null,
          avatarUrl: null,
        }),
      );
    },
    async login(input: LoginRequest) {
      const user = await repository.findByEmail(input.email);
      const valid = await verifyPassword(
        input.password,
        user?.passwordHash ?? null,
      );
      if (!valid || !user)
        throw new AuthError(
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect.",
        );
      return publicUser(user);
    },
    async googleLogin(identity: GoogleIdentity) {
      const existing = await repository.findByGoogleSubject(identity.subject);
      const profile = {
        name: identity.name,
        email: identity.email,
        avatarUrl: identity.avatarUrl,
      };
      if (existing)
        return publicUser(await repository.updateGoogle(existing.id, profile));
      if (await repository.findByEmail(identity.email))
        throw new AuthError(
          409,
          "ACCOUNT_EXISTS",
          "An account already uses this email. Sign in using its existing login method.",
        );
      return publicUser(
        await repository.create({
          ...profile,
          googleSubject: identity.subject,
          passwordHash: null,
        }),
      );
    },
    async currentUser(id: string | undefined) {
      const user = id ? await repository.findById(id) : null;
      if (!user)
        throw new AuthError(401, "UNAUTHENTICATED", "Sign in to continue.");
      return publicUser(user);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
