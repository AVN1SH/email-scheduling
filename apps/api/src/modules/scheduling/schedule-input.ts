import { createHash } from "node:crypto";
import { z } from "zod";
import type { ScheduleRequest } from "@repo/shared";
import { AppError } from "../../errors/app-error.js";

export function normalizeRecipients(input: string[]) {
  const recipients: string[] = [],
    duplicates = new Set<string>(),
    seen = new Set<string>();
  const invalid: string[] = [];
  for (const raw of input) {
    const email = raw.trim().toLowerCase();
    if (!z.email().max(254).safeParse(email).success) {
      invalid.push(raw);
      continue;
    }
    if (seen.has(email)) duplicates.add(email);
    else {
      seen.add(email);
      recipients.push(email);
    }
  }
  if (invalid.length)
    throw new AppError(
      400,
      "INVALID_RECIPIENTS",
      "Correct the invalid email addresses before scheduling.",
      { invalidRecipients: invalid },
    );
  return { recipients, duplicates: [...duplicates] };
}

export function scheduleHash(input: ScheduleRequest) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        senderId: input.senderId,
        recipients: input.recipients.map((value) => value.trim().toLowerCase()),
        subject: input.subject,
        body: input.body,
        ...(input.bodyHtml !== undefined ? { bodyHtml: input.bodyHtml } : {}),
        ...(input.attachmentIds !== undefined
          ? { attachmentIds: [...input.attachmentIds].sort() }
          : {}),
        startAt: new Date(input.startAt).toISOString(),
        delayMs: input.delayMs ?? null,
        hourlyLimit: input.hourlyLimit ?? null,
      }),
    )
    .digest("hex");
}
