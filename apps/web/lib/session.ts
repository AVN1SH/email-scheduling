import "server-only";
import { cookies } from "next/headers";
import { authResponseSchema } from "@repo/shared";

export async function getSession() {
  const cookie = (await cookies()).toString();
  const origin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
  const response = await fetch(`${origin}/auth/me`, {
    headers: { cookie },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error("Account information is temporarily unavailable.");
  return authResponseSchema.parse(await response.json());
}
