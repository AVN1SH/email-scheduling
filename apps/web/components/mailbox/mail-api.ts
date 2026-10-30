import {
  apiErrorSchema,
  emailDetailSchema,
  type EmailUpdate,
} from "@repo/shared";

export class MailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MailApiError";
  }
}
export async function mailRequest<T>(
  path: string,
  schema: { parse(value: unknown): T },
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
  });
  const body: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new MailApiError(
      error.success
        ? error.data.error.message
        : "Could not load your email. Please try again.",
      response.status,
    );
  }
  return schema.parse(body);
}
export function updateEmail(id: string, input: EmailUpdate, csrfToken: string) {
  return mailRequest(`/emails/${id}`, emailDetailSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(input),
  });
}
export function deleteEmail(id: string, csrfToken: string) {
  return mailRequest(
    `/emails/${id}`,
    { parse: () => undefined },
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: "{}",
    },
  );
}
