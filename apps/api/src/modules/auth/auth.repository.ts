import type { Database } from "@repo/db";
import { AuthError } from "./auth-error.js";

export type AuthRecord = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  passwordHash: string | null;
  googleSubject: string | null;
};

export interface AuthRepository {
  findById(id: string): Promise<AuthRecord | null>;
  findByEmail(email: string): Promise<AuthRecord | null>;
  findByGoogleSubject(subject: string): Promise<AuthRecord | null>;
  create(data: Omit<AuthRecord, "id">): Promise<AuthRecord>;
  updateGoogle(
    id: string,
    data: { name: string | null; email: string; avatarUrl: string | null },
  ): Promise<AuthRecord>;
}

function handleConflict(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  ) {
    throw new AuthError(
      409,
      "ACCOUNT_EXISTS",
      "An account already uses this email. Sign in using its existing login method.",
    );
  }
  throw error;
}

export function createAuthRepository(database: Database): AuthRepository {
  return {
    findById: (id) => database.user.findUnique({ where: { id } }),
    findByEmail: (email) => database.user.findUnique({ where: { email } }),
    findByGoogleSubject: (googleSubject) =>
      database.user.findUnique({ where: { googleSubject } }),
    create: (data) => database.user.create({ data }).catch(handleConflict),
    updateGoogle: (id, data) =>
      database.user.update({ where: { id }, data }).catch(handleConflict),
  };
}
