import { senderImportSchema, type SafeSender } from "@repo/shared";
import type { Database } from "@repo/db";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { encryptCredentials, senderIdentity } from "./credentials.js";

const safeSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
} as const;
const toPublic = (sender: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}): SafeSender => ({ ...sender, createdAt: sender.createdAt.toISOString() });

export function createSendersService(
  database: Database,
  encryptionKey: string,
) {
  return {
    async list(userId: string) {
      return {
        items: (
          await database.sender.findMany({
            where: { userId, active: true },
            select: safeSelect,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        ).map(toPublic),
      };
    },
    async import(userId: string, input: unknown) {
      const parsed = z
        .array(senderImportSchema)
        .min(1)
        .max(50)
        .safeParse(input);
      if (!parsed.success)
        throw new AppError(
          400,
          "INVALID_SENDERS",
          "Check the sender file's fields and Ethereal SMTP settings.",
        );
      const identities = parsed.data.map(senderIdentity);
      if (new Set(identities).size !== identities.length)
        throw new AppError(
          400,
          "DUPLICATE_SENDERS",
          "Use distinct SMTP accounts in the sender file.",
        );
      const senders = await database.$transaction(
        parsed.data.map((sender, index) => {
          const identityKey = identities[index]!;
          const data = {
            name: sender.name,
            email: sender.email,
            credentialsEncrypted: encryptCredentials(
              sender,
              encryptionKey,
              userId,
            ),
            active: true,
          };
          return database.sender.upsert({
            where: { userId_identityKey: { userId, identityKey } },
            create: { userId, identityKey, ...data },
            update: data,
            select: safeSelect,
          });
        }),
      );
      return { items: senders.map(toPublic) };
    },
  };
}
export type SendersService = ReturnType<typeof createSendersService>;
