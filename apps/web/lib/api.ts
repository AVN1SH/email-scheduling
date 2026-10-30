import {
  apiErrorSchema,
  authResponseSchema,
  type AuthResponse,
} from "@repo/shared";

export async function submitAuth(
  path: "login" | "register",
  input: unknown,
): Promise<AuthResponse> {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new Error(
      error.success
        ? error.data.error.message
        : "Unable to sign in. Please try again.",
    );
  }
  return authResponseSchema.parse(body);
}
